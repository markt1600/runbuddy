// GPS tracking: watchPosition + haversine distance + rolling pace.

export interface GeoSample {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
  /** Doppler-derived ground speed in m/s, when the platform supplies it. */
  speed: number | null;
}

// Tuning. The important one is ACCURACY_FACTOR: GPS noise is always a positive
// displacement, so without a gate that scales with the accuracy circle, a phone
// standing still quietly accumulates distance forever.
const MAX_ACCURACY_M = 30; // fixes worse than this never move the distance
const MIN_MOVE_M = 6; // absolute floor for a step to count
const ACCURACY_FACTOR = 0.5; // …and it must also beat half the accuracy radius
const STATIONARY_MPS = 0.6; // Doppler speed below this = standing still
const MAX_SPEED_KMH = 30; // anything faster is a GPS teleport, not a runner
const WARMUP_MS = 4000; // ignore the first fixes; cold-start drift is worst
const SPEED_SMOOTHING = 0.3; // EMA weight on the newest speed reading
const MAX_GAP_S = 5; // longest interval a single speed reading may cover
const DOPPLER_STALE_MS = 15_000; // after this, fall back to position deltas
const KALMAN_Q = 2.5; // m/s of expected movement — the filter's process noise

export function haversineKm(a: GeoSample, b: GeoSample): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type GpsSignal = "acquiring" | "good" | "weak" | "lost" | "denied" | "unavailable";

export class GeoTracker {
  private watchId: number | null = null;
  private last: GeoSample | null = null;
  private recent: { t: number; km: number }[] = []; // cumulative distance samples for rolling pace
  private history: { t: number; km: number }[] = []; // full-run samples for last-km moving average
  private lastFixAt = 0; // any fix, even a rejected low-accuracy one
  private lastGoodFixAt = 0; // fix accurate enough to count toward distance
  private lastAccuracy: number | null = null;
  private denied = false;
  private unavailable = false;
  private startedAt = 0; // for the warm-up discard
  private speedEma: number | null = null; // km/h, smoothed Doppler speed
  private lastSpeedMps = 0; // previous Doppler reading, for trapezoid integration
  private lastSpeedAt = 0;
  private dopplerSeen = false;
  private kLat = 0; // Kalman-smoothed position…
  private kLon = 0;
  private kVar = -1; // …and its variance in m², negative until seeded
  private kAt = 0; // timestamp of the fix the filter last absorbed
  /** True when the Doppler reading says the phone isn't actually moving. */
  stationary = false;
  /** While paused the watch keeps running (so the fix stays warm) but nothing counts. */
  paused = false;
  distanceKm = 0;
  lastError: string | null = null;
  /** Most recent fix of any accuracy — good enough for weather / geocoding. */
  lastPosition: { lat: number; lon: number } | null = null;
  /** Accepted fixes forming the run's path (downsampled when long). */
  route: { lat: number; lon: number }[] = [];

  start(onUpdate: () => void) {
    if (!("geolocation" in navigator)) {
      this.unavailable = true;
      this.lastError = "Location not available on this device";
      return;
    }
    this.startedAt = Date.now();
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const raw = pos.coords.speed;
        const s: GeoSample = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
          // iOS reports -1 (or null) when it has no Doppler solution.
          speed: typeof raw === "number" && isFinite(raw) && raw >= 0 ? raw : null,
        };
        const now = Date.now();
        this.denied = false;
        this.lastFixAt = now;
        this.lastAccuracy = s.accuracy;
        this.lastPosition = { lat: s.lat, lon: s.lon };
        this.lastError = null;

        // Cold-start fixes are the worst ones the receiver will ever produce —
        // let the first few seconds go by before anything counts.
        if (now - this.startedAt < WARMUP_MS) {
          onUpdate();
          return;
        }
        // Doppler ground speed is measured off the carrier phase, not
        // differentiated from position, so it reads ~0 when you're standing
        // still even as the fix wanders. Where we have it, it's the authority
        // on whether we're moving — and its quality doesn't depend on how good
        // the *position* fix is, so this runs before the accuracy gate.
        this.stationary = s.speed !== null && s.speed < STATIONARY_MPS;
        if (s.speed !== null) {
          const mps = this.stationary ? 0 : s.speed;
          const kmh = mps * 3.6;
          this.speedEma =
            this.speedEma === null
              ? kmh
              : this.speedEma + SPEED_SMOOTHING * (kmh - this.speedEma);
          // Integrate speed over time rather than summing position deltas.
          // Position noise is unsigned, so summing deltas always overstates
          // the distance; speed noise is symmetric, so integrating it doesn't.
          const dtSec = Math.min((now - this.lastSpeedAt) / 1000, MAX_GAP_S);
          if (this.dopplerSeen && dtSec > 0 && !this.paused) {
            this.distanceKm += (((this.lastSpeedMps + mps) / 2) * dtSec) / 1000;
          }
          this.dopplerSeen = true;
          this.lastSpeedMps = mps;
          this.lastSpeedAt = now;
        }

        // Drop inaccurate fixes (indoors, urban canyon) — they still count as
        // "the GPS is alive", just not toward the route or distance.
        if (s.accuracy > MAX_ACCURACY_M) {
          onUpdate();
          return;
        }
        this.lastGoodFixAt = now;

        // Smooth the position before it is used for anything. This is the
        // standard scalar Kalman filter: trust the new fix in proportion to
        // how it compares with our accumulated uncertainty, which grows with
        // however far we could plausibly have moved since the last one.
        const f = this.smooth(s);
        // Distance from positions is the fallback for devices that give us no
        // speed at all (and for a long Doppler dropout mid-run).
        const useDelta = !this.dopplerSeen || now - this.lastSpeedAt > DOPPLER_STALE_MS;

        if (this.paused) {
          // Keep the anchor under the phone so whatever you do while paused —
          // walk back to the car, queue for water — isn't waiting to be added
          // to the total the moment you hit resume.
          this.last = f;
        } else if (!this.last) {
          this.last = f;
          this.pushRoutePoint(f);
        } else if (!this.stationary) {
          const d = haversineKm(this.last, f);
          const dtHrs = (f.timestamp - this.last.timestamp) / 3_600_000;
          // The gate scales with the accuracy circle: a fix good to 20 m can
          // easily jitter 10 m, so 3 m of "movement" proves nothing. Anything
          // under the gate leaves the anchor where it is rather than dragging
          // it along with the noise — that's what stops a stationary phone
          // from quietly clocking up a kilometre.
          const gateKm = Math.max(MIN_MOVE_M, s.accuracy * ACCURACY_FACTOR) / 1000;
          if (d > gateKm && (dtHrs <= 0 || d / dtHrs < MAX_SPEED_KMH)) {
            if (useDelta) this.distanceKm += d;
            this.last = f;
            this.pushRoutePoint(f);
          }
        }

        const sample = { t: now, km: this.distanceKm };
        this.recent.push(sample);
        this.history.push(sample);
        const cutoff = now - 60_000;
        while (this.recent.length > 2 && this.recent[0].t < cutoff) this.recent.shift();
        onUpdate();
      },
      (err) => {
        this.denied = err.code === err.PERMISSION_DENIED;
        this.lastError = this.denied ? "Location permission denied" : "Waiting for GPS…";
        onUpdate();
      },
      // maximumAge: 0 — never hand us a cached fix; a stale one replayed as new
      // looks like a jump back to where we were a moment ago.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  /**
   * Scalar Kalman filter over the raw fix. Uncertainty grows by KALMAN_Q m/s
   * between fixes and shrinks each time one arrives; the gain that falls out
   * is how much of the new fix we believe. A tight fix pulls the estimate
   * hard, a loose one barely moves it — which is exactly the behaviour that
   * stops the dot (and the pace) twitching while you stand at a crossing.
   */
  private smooth(s: GeoSample): GeoSample {
    const acc = Math.max(s.accuracy, 1);
    if (this.kVar < 0) {
      this.kLat = s.lat;
      this.kLon = s.lon;
      this.kVar = acc * acc;
    } else {
      // Time since the last *fix*, not since the last accepted step — the
      // anchor sits still for minutes at a red light, and pacing the filter
      // off it would inflate the uncertainty until it stopped smoothing.
      const dtSec = Math.min(Math.max((s.timestamp - this.kAt) / 1000, 0), MAX_GAP_S);
      this.kVar += dtSec * KALMAN_Q * KALMAN_Q;
      const gain = this.kVar / (this.kVar + acc * acc);
      this.kLat += gain * (s.lat - this.kLat);
      this.kLon += gain * (s.lon - this.kLon);
      this.kVar *= 1 - gain;
    }
    this.kAt = s.timestamp;
    return { ...s, lat: this.kLat, lon: this.kLon };
  }

  private pushRoutePoint(s: GeoSample) {
    this.route.push({ lat: s.lat, lon: s.lon });
    // Keep the path drawable: halve resolution once it gets long, keeping ends
    if (this.route.length > 1500) {
      this.route = this.route.filter((_, i) => i % 2 === 0 || i === this.route.length - 1);
    }
  }

  /**
   * Live signal quality, judged by how recently we got a usable fix:
   * - good:      accurate fix in the last 10s
   * - weak:      some fix in the last 10s, but too inaccurate for distance
   * - acquiring: no fix yet since start (cold GPS)
   * - lost:      we had fixes before, but nothing for 10s+
   */
  signal(): GpsSignal {
    if (this.unavailable) return "unavailable";
    if (this.denied) return "denied";
    const now = Date.now();
    if (this.lastFixAt === 0) return "acquiring";
    if (now - this.lastGoodFixAt < 10_000 && (this.lastAccuracy ?? 99) <= MAX_ACCURACY_M)
      return "good";
    if (now - this.lastFixAt < 10_000) return "weak";
    return "lost";
  }

  /**
   * Current speed in km/h. Prefers the smoothed Doppler reading — it settles on
   * a steady number where differentiating positions visibly twitches — and
   * falls back to distance over the last `seconds` when the platform gives us
   * no speed at all.
   */
  speedKmhLastSeconds(seconds: number): number | null {
    if (this.stationary) return 0;
    if (this.speedEma !== null) return this.speedEma;
    if (this.recent.length < 2) return null;
    const now = this.recent[this.recent.length - 1];
    const targetT = now.t - seconds * 1000;
    // Most recent sample at or before the window start
    let then = this.recent[0];
    for (let i = this.recent.length - 1; i >= 0; i--) {
      if (this.recent[i].t <= targetT) {
        then = this.recent[i];
        break;
      }
    }
    const dtHrs = (now.t - then.t) / 3_600_000;
    if (dtHrs * 3600 < seconds * 0.5) return null; // window not filled yet
    return (now.km - then.km) / dtHrs;
  }

  /** Moving average speed over the last kilometre. Null until 1 km is run. */
  lastKmSpeedKmh(): number | null {
    if (this.distanceKm < 1 || this.history.length < 2) return null;
    const now = this.history[this.history.length - 1];
    const targetKm = now.km - 1;
    // Most recent sample at or before one kilometre ago
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].km <= targetKm) {
        const then = this.history[i];
        const dtHrs = (now.t - then.t) / 3_600_000;
        if (dtHrs <= 0) return null;
        return (now.km - then.km) / dtHrs;
      }
    }
    return null;
  }

  /** Rolling pace over the last minute, in seconds per km. Null until enough movement. */
  rollingPaceSecPerKm(): number | null {
    if (this.recent.length < 2) return null;
    const first = this.recent[0];
    const last = this.recent[this.recent.length - 1];
    const dKm = last.km - first.km;
    const dSec = (last.t - first.t) / 1000;
    if (dKm < 0.02 || dSec < 15) return null; // not enough signal
    return dSec / dKm;
  }
}

export function formatSpeed(kmh: number | null): string {
  if (kmh === null || !isFinite(kmh) || kmh < 0) return "--";
  return kmh.toFixed(1);
}

export function formatPace(secPerKm: number | null): string {
  if (secPerKm === null || !isFinite(secPerKm) || secPerKm > 30 * 60) return "--'--\"";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${s.toString().padStart(2, "0")}"`;
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
