// Run environment: current weather + where the runner is.
// Both sources are free and keyless (Open-Meteo, BigDataCloud reverse geocode),
// fetched client-side from the first GPS fix and refreshed every 30 minutes.

export interface RunEnvironment {
  locality: string | null; // e.g. "Bishan", "Marina Bay"
  weatherDesc: string | null; // e.g. "partly cloudy"
  tempC: number | null;
  feelsLikeC: number | null;
  windKmh: number | null;
  fetchedAt: number;
}

const WMO_CODES: Record<number, string> = {
  0: "clear skies",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "foggy",
  51: "light drizzle",
  53: "drizzling",
  55: "heavy drizzle",
  61: "light rain",
  63: "raining",
  65: "pouring rain",
  66: "freezing rain",
  67: "freezing rain",
  71: "light snow",
  73: "snowing",
  75: "heavy snow",
  80: "rain showers",
  81: "rain showers",
  82: "violent rain showers",
  85: "snow showers",
  86: "snow showers",
  95: "a thunderstorm",
  96: "a thunderstorm with hail",
  99: "a thunderstorm with hail",
};

export async function fetchRunEnvironment(lat: number, lon: number): Promise<RunEnvironment> {
  const env: RunEnvironment = {
    locality: null,
    weatherDesc: null,
    tempC: null,
    feelsLikeC: null,
    windKmh: null,
    fetchedAt: Date.now(),
  };

  const weather = fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m`
  )
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const cur = data?.current;
      if (!cur) return;
      env.tempC = typeof cur.temperature_2m === "number" ? Math.round(cur.temperature_2m) : null;
      env.feelsLikeC =
        typeof cur.apparent_temperature === "number" ? Math.round(cur.apparent_temperature) : null;
      env.windKmh = typeof cur.wind_speed_10m === "number" ? Math.round(cur.wind_speed_10m) : null;
      env.weatherDesc = WMO_CODES[cur.weather_code as number] ?? null;
    })
    .catch(() => {});

  const place = fetch(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
  )
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      env.locality = data?.locality || data?.city || data?.principalSubdivision || null;
    })
    .catch(() => {});

  await Promise.all([weather, place]);
  return env;
}

export function describeEnvironment(env: RunEnvironment | null): string | null {
  if (!env) return null;
  const parts: string[] = [];
  if (env.locality) parts.push(`📍 ${env.locality}`);
  if (env.tempC !== null) {
    parts.push(`${env.weatherDesc ? weatherEmoji(env.weatherDesc) + " " : ""}${env.tempC}°C`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function weatherEmoji(desc: string): string {
  if (desc.includes("clear")) return "☀️";
  if (desc.includes("cloud") || desc.includes("overcast")) return "☁️";
  if (desc.includes("rain") || desc.includes("drizzl")) return "🌧";
  if (desc.includes("thunder")) return "⛈";
  if (desc.includes("snow")) return "🌨";
  if (desc.includes("fog")) return "🌫";
  return "🌤";
}
