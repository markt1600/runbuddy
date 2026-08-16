// GPS tracking: watchPosition + haversine distance + rolling pace.

export interface GeoSample {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
}

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

export class GeoTracker {
  private watchId: number | null = null;
  private last: GeoSample | null = null;
  private recent: { t: number; km: number }[] = []; // cumulative distance samples for rolling pace
  distanceKm = 0;
  lastError: string | null = null;

  start(onUpdate: () => void) {
    if (!("geolocation" in navigator)) {
      this.lastError = "Location not available on this device";
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const s: GeoSample = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
        // Drop wildly inaccurate fixes (indoors, cold start)
        if (s.accuracy > 50) return;
        if (this.last) {
          const d = haversineKm(this.last, s);
          const dtHrs = (s.timestamp - this.last.timestamp) / 3_600_000;
          // Reject GPS jitter (< ~3m) and teleports (> 25 km/h running speed)
          if (d > 0.003 && (dtHrs <= 0 || d / dtHrs < 25)) {
            this.distanceKm += d;
            this.last = s;
          } else if (d <= 0.003) {
            this.last = s;
          }
        } else {
          this.last = s;
        }
        this.recent.push({ t: Date.now(), km: this.distanceKm });
        const cutoff = Date.now() - 60_000;
        while (this.recent.length > 2 && this.recent[0].t < cutoff) this.recent.shift();
        this.lastError = null;
        onUpdate();
      },
      (err) => {
        this.lastError =
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied"
            : "Waiting for GPS…";
        onUpdate();
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
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
