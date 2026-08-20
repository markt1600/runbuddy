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
// After a gap this long the filtered position is stale rather than merely
// uncertain, so it is re-seeded instead of blended. Without this, the estimate
// crawls back toward reality over several fixes, and each of those catch-up
// steps looks like a teleport and gets rejected — freezing the distance for
// seconds every time a runner comes out of a tunnel.
const FILTER_RESET_MS = 6000;

// Auto-pause. Confirming a pause harder than a resume is deliberate: a false
// pause eats real distance, a false resume just adds a couple of standing-still
// seconds. Both transitions are reported back-dated to the fix that actually
// turned, so the ~2s of confirmation costs nothing in the recorded stats.
const AUTO_PAUSE_FIXES = 3; // ~3s of standing still before we pause
const AUTO_RESUME_FIXES = 2; // ~2s of movement before we resume
const AUTO_RETRIGGER_MS = 3000; // don't bounce straight back into a pause
// Fallback for receivers that report no speed at all: watch for distance to
// stop growing. The thresholds are asymmetric so a single noisy step — which
// smears across the whole window — can't declare you running again.
const STALL_WINDOW_MS = 8000;
const STALL_STOP_KM = 0.006;
const STALL_GO_KM = 0.015;
// "Distance stopped growing" looks identical to "we're in a tunnel and the
// signal died", so the stall path only gets to conclude anything while good
// fixes are genuinely still arriving at a steady rate.
const STALL_FIX_GAP_MS = 4000;
const STALL_MIN_SAMPLES = 5;
// Armed resume, for devices that give us no Doppler speed. The settle delay
// matters: the position filter lags for a few seconds after an abrupt stop, and
// that catch-up looks exactly like setting off again. The window is trailing
// rather than anchored so slow drift over a long pause never accumulates into a
// false start either.
const ARM_MOVE_M = 15;
const ARM_SETTLE_MS = 3000;
const ARM_WINDOW_MS = 6000;

// Gap bridging ("approximate distance correction"). The Doppler trapezoid
// credits at most MAX_GAP_S per fix interval, so when iOS delivers fixes
// sparsely — a locked phone in an arm sleeve — every interval past the cap is
// distance silently thrown away: at 2–6 s fix spacing a 10 km run reads ~3%
// short. When a usable fix ends a longer interval, credit the smoothed-position
// chord across it instead (minus whatever the trapezoid already granted).
// The recovery is bounded by the position chord AND by the clipped seconds at
// the bracketing Doppler speed, so it can only give back what the cap took.

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

  private stillRun = 0;
  private moveRun = 0;
  private firstStillAt = 0;
  private firstMoveAt = 0;
  private lastAutoResumeAt = 0;
  private stallLog: { t: number; km: number }[] = [];
  /** Turn the whole auto-pause behaviour off (user preference). */
  autoPauseEnabled = true;
  /** True while the tracker believes the runner has stopped. */
  autoPaused = false;
  /** Called when the run should pause. The argument is when movement actually stopped. */
  onAutoPause: ((atMs: number) => void) | null = null;
  /** Called when the run should resume. The argument is when movement actually restarted. */
  onAutoResume: ((atMs: number) => void) | null = null;
  /** True while a manual pause is waiting for the runner to move off again. */
  armedForResume = false;
  private armedAt = 0;
  private armTrail: { t: number; lat: number; lon: number }[] = [];
  /** Called when an armed manual pause sees the runner start moving. */
  onArmedResume: ((atMs: number) => void) | null = null;
  distanceKm = 0;
  lastError: string | null = null;
  /** Bridge long fix gaps with the position chord (user preference). */
  gapBridging = true;
  private bridgeAnchor: GeoSample | null = null;
  private trapezoidKmThisFix = 0; // what the Doppler credit granted for the current fix
  private clippedSecThisFix = 0; // seconds the trapezoid cap threw away at this fix
  private bridgeSpeedMps = 0; // the speed estimate those seconds would have earned
  /** Metres recovered by gap bridging this run — surfaced on the summary. */
  bridgedKm = 0;
  // Fix-delivery diagnostics, to tell "GPS was sparse" from "run was short".
  private fixGapCount = 0;
  private fixGapSumSec = 0;
  private fixGapMaxSec = 0;
  private fixGapOverCapSec = 0;
  /** Most recent fix of any accuracy — good enough for weather / geocoding. */
  lastPosition: { lat: number; lon: number } | null = null;
  /** Accepted fixes forming the run's path (downsampled when long). */
  route: { lat: number; lon: number; t?: number }[] = [];

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
        // Delivery-rate diagnostics, warm-up included: the question they
        // answer is "how sparsely was iOS feeding us", not "how far we ran".
        if (this.lastFixAt > 0) {
          const gapSec = (now - this.lastFixAt) / 1000;
          this.fixGapCount++;
          this.fixGapSumSec += gapSec;
          if (gapSec > this.fixGapMaxSec) this.fixGapMaxSec = gapSec;
          if (gapSec > MAX_GAP_S) this.fixGapOverCapSec += gapSec - MAX_GAP_S;
        }
        this.lastFixAt = now;
        this.trapezoidKmThisFix = 0;
        this.clippedSecThisFix = 0;
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
          const rawGapSec = (now - this.lastSpeedAt) / 1000;
          const dtSec = Math.min(rawGapSec, MAX_GAP_S);
          if (this.dopplerSeen && dtSec > 0 && !this.paused) {
            const add = (((this.lastSpeedMps + mps) / 2) * dtSec) / 1000;
            this.distanceKm += add;
            // Remembered for gap bridging (position domain, below): what this
            // interval already earned, how many of its seconds the cap threw
            // away, and what speed those seconds would have integrated at.
            this.trapezoidKmThisFix = add;
            this.clippedSecThisFix = rawGapSec - dtSec;
            this.bridgeSpeedMps = (this.lastSpeedMps + mps) / 2;
          }
          this.dopplerSeen = true;
          this.lastSpeedMps = mps;
          this.lastSpeedAt = now;
        }

        // Inaccurate fixes (indoors, urban canyon) still count as "the GPS is
        // alive", just not toward the route or distance.
        const usable = s.accuracy <= MAX_ACCURACY_M;
        if (usable) this.trackPosition(s, now);
        // Doppler tells us about movement regardless of how good the position
        // is; without it, a coarse fix tells us nothing either way.
        if (s.speed !== null || usable) this.detectAutoPause(s, now);
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

  /** Forget the auto-pause state — for when the runner overrides it by hand. */
  clearAutoPause() {
    this.autoPaused = false;
    this.stillRun = 0;
    this.moveRun = 0;
    this.lastAutoResumeAt = Date.now();
  }

  /** Route, anchor and the position-derived distance fallback. Accurate fixes only. */
  private trackPosition(s: GeoSample, now: number) {
    const prevGoodFixAt = this.lastGoodFixAt;
    this.lastGoodFixAt = now;

    // Smooth the position before it is used for anything. This is the
        // standard scalar Kalman filter: trust the new fix in proportion to
        // how it compares with our accumulated uncertainty, which grows with
        // however far we could plausibly have moved since the last one.
        const f = this.smooth(s);
        // Distance from positions is the fallback for devices that give us no
        // speed at all (and for a long Doppler dropout mid-run).
        const useDelta = !this.dopplerSeen || now - this.lastSpeedAt > DOPPLER_STALE_MS;

        // Gap bridging: the trapezoid cap threw seconds away at this fix —
        // recover them, bounded by BOTH independent measurements of the gap.
        // The chord bound (you cannot have covered more ground than the line
        // between where you vanished and where you reappeared) stops a runner
        // who paused mid-gap from being credited with motion; the speed bound
        // (the clipped seconds at the bracketing Doppler speed) stops unsigned
        // position noise from accumulating — chord noise only ever points
        // outward, which is exactly the phantom distance this tracker's
        // Doppler-first design exists to avoid, and an unbounded chord credit
        // reintroduced it at +3% in simulation. Delta mode is excluded: its
        // anchor arithmetic already spans gaps uncapped.
        const gapSec = prevGoodFixAt > 0 ? (now - prevGoodFixAt) / 1000 : 0;
        if (
          this.gapBridging &&
          !this.paused &&
          !useDelta &&
          this.bridgeAnchor !== null &&
          this.clippedSecThisFix > 0
        ) {
          // Raw fixes, not smoothed: the Kalman estimate lags its inputs, and
          // a chord between two lagging endpoints reads systematically short —
          // in simulation it cut the recovery to a third of what was lost.
          // Raw noise is symmetric, and the speed bound already clips the high
          // side, so raw is both fuller and still safe.
          const chordKm = haversineKm(this.bridgeAnchor, s);
          const chordKmh = gapSec > 0 ? chordKm / (gapSec / 3600) : Infinity;
          const chordBoundKm = chordKm - this.trapezoidKmThisFix;
          const speedBoundKm = (this.bridgeSpeedMps * this.clippedSecThisFix) / 1000;
          const recovered = Math.min(chordBoundKm, speedBoundKm);
          // A chord implying faster-than-runner travel is GPS error, not travel.
          if (chordKmh < MAX_SPEED_KMH && recovered > 0) {
            this.distanceKm += recovered;
            this.bridgedKm += recovered;
          }
        }
        this.bridgeAnchor = s;

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
  }

  /**
   * Auto-pause state machine. Doppler speed is the primary evidence; where the
   * receiver gives us none, we fall back to watching for distance to stop
   * growing, which is both slower and less certain.
   */
  private detectAutoPause(s: GeoSample, now: number) {
    // A manual pause owns the run state — don't fight it, and don't come back
    // from it on our own. The one exception is a resume the runner has armed
    // by hand, where watching for the go edge is exactly the job.
    if (this.armedForResume && this.paused) {
      this.watchForArmedResume(s, now);
      return;
    }
    if (!this.autoPauseEnabled || this.paused) {
      this.stillRun = 0;
      this.moveRun = 0;
      this.autoPaused = false;
      return;
    }
    this.stallLog.push({ t: now, km: this.distanceKm });
    // Keep the newest entry that is still *older* than the window — the same
    // trailing-window pruning as the armed-resume trail, and for the same
    // reason: dropping everything past the cutoff discards the only sample
    // that can prove the window is filled, so the "window not filled" guard
    // below returns on every fix and the no-Doppler stall path never fires.
    while (this.stallLog.length > 1 && this.stallLog[1].t <= now - STALL_WINDOW_MS) {
      this.stallLog.shift();
    }

    let stopped: boolean;
    if (s.speed !== null) {
      // Doppler is measured, not inferred, so it stays trustworthy under a
      // bridge or between tower blocks where the position fix falls apart.
      stopped = this.stationary;
    } else {
      // Without it we're inferring from distance, which a tunnel would fake
      // perfectly. Refuse to judge unless accurate fixes have been arriving
      // steadily across the whole window — otherwise a runner who ducks into
      // an underpass gets paused mid-stride.
      if (now - this.stallLog[0].t < STALL_WINDOW_MS) return; // window not filled
      if (now - this.lastGoodFixAt > STALL_FIX_GAP_MS) return; // signal trouble
      if (this.stallLog.length < STALL_MIN_SAMPLES) return; // fix rate collapsed
      const movedKm = this.distanceKm - this.stallLog[0].km;
      stopped = movedKm < (this.autoPaused ? STALL_GO_KM : STALL_STOP_KM);
    }

    if (stopped) {
      if (this.stillRun === 0) this.firstStillAt = now;
      this.stillRun++;
      this.moveRun = 0;
    } else {
      if (this.moveRun === 0) this.firstMoveAt = now;
      this.moveRun++;
      this.stillRun = 0;
    }

    if (
      !this.autoPaused &&
      this.stillRun >= AUTO_PAUSE_FIXES &&
      now - this.lastAutoResumeAt > AUTO_RETRIGGER_MS
    ) {
      this.autoPaused = true;
      this.onAutoPause?.(this.firstStillAt);
    } else if (this.autoPaused && this.moveRun >= AUTO_RESUME_FIXES) {
      this.autoPaused = false;
      this.lastAutoResumeAt = now;
      this.onAutoResume?.(this.firstMoveAt);
    }
  }

  /**
   * Armed resume: the runner paused by hand, put the phone away, and the clock
   * should start itself the moment they run again. Distance is frozen while we
   * wait, so the stall detector has nothing to read — we measure displacement
   * from a reference fix instead, and lean on Doppler where it exists.
   */
  private watchForArmedResume(s: GeoSample, now: number) {
    this.stillRun = 0;
    this.autoPaused = false;
    // Long enough to stow the phone, and for the filter to settle after the
    // stop that preceded the pause.
    if (now - this.armedAt < ARM_SETTLE_MS) return;

    let moving: boolean;
    if (s.speed !== null) {
      moving = !this.stationary;
    } else {
      // Smoothed positions over a trailing window. Raw fixes at 25 m accuracy
      // wander far enough on their own to clear any gate worth having.
      this.armTrail.push({ t: now, lat: this.kLat, lon: this.kLon });
      // Keep the newest entry that is still *older* than the window. Dropping
      // everything past the cutoff instead would discard the only sample that
      // can satisfy the check below, and the window would never fill — which
      // it doesn't, unless fixes happen to land on exact window boundaries.
      while (this.armTrail.length > 1 && this.armTrail[1].t <= now - ARM_WINDOW_MS) {
        this.armTrail.shift();
      }
      const from = this.armTrail[0];
      if (now - from.t < ARM_WINDOW_MS) return; // window not filled yet
      // A bigger gate than the running one: a false start here restarts the
      // clock while the runner is still fiddling with a sleeve.
      const movedM =
        haversineKm({ ...s, lat: from.lat, lon: from.lon }, { ...s, lat: this.kLat, lon: this.kLon }) *
        1000;
      moving = movedM > Math.max(ARM_MOVE_M, s.accuracy * ACCURACY_FACTOR);
    }

    if (moving) {
      if (this.moveRun === 0) this.firstMoveAt = now;
      this.moveRun++;
    } else {
      this.moveRun = 0;
    }
    if (this.moveRun >= AUTO_RESUME_FIXES) {
      this.disarmResume();
      this.lastAutoResumeAt = now;
      this.onArmedResume?.(this.firstMoveAt);
    }
  }

  /** Start watching for the runner to move again after a manual pause. */
  armResume() {
    this.armedForResume = true;
    this.armedAt = Date.now();
    this.armTrail = [];
    this.moveRun = 0;
    this.stillRun = 0;
  }

  disarmResume() {
    this.armedForResume = false;
    this.armTrail = [];
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
    if (this.kVar >= 0 && s.timestamp - this.kAt > FILTER_RESET_MS) {
      this.kVar = -1; // stale beyond rescue — start again from this fix
    }
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
    // t: seconds since the watch started — makes a saved trace re-analyzable
    // offline (fix cadence, per-segment speed) without growing the payload much.
    this.route.push({
      lat: s.lat,
      lon: s.lon,
      t: Math.round((s.timestamp - this.startedAt) / 1000),
    });
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
  /**
   * How well iOS actually fed us this run. Sparse delivery (locked phone in a
   * sleeve) is the difference between a run that measures true and one that
   * reads short, so the summary shows this instead of leaving the drift a
   * mystery.
   */
  fixDiagnostics(): {
    avgFixGapSec: number | null;
    maxFixGapSec: number;
    overCapSec: number;
    bridgedKm: number;
  } {
    return {
      avgFixGapSec: this.fixGapCount > 0 ? this.fixGapSumSec / this.fixGapCount : null,
      maxFixGapSec: this.fixGapMaxSec,
      overCapSec: this.fixGapOverCapSec,
      bridgedKm: this.bridgedKm,
    };
  }

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
