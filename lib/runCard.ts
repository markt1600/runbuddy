import { formatElapsed } from "./geo";
import { formatInUnit, unitSuffix, type SpeedUnit } from "./units";
import type { Persona, RunStats } from "./types";

// Renders the end-of-run infographic: a square 1080×1080 PNG with the route,
// the headline numbers and the coach's closing line. Drawn on a canvas so it
// can be saved to Photos / shared straight from the summary screen.

export const CARD_SIZE = 1080;

// The card is the one artefact that leaves the app, so it carries the full
// system: paper ground, Fraunces figures, mono labels. Families are read from
// the same custom properties the stylesheet uses — next/font mangles the family
// name at build time, so hardcoding "Fraunces" here would silently draw the
// fallback. Falls back to a plain stack if the vars are missing (SSR, tests).
function familyFrom(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

const DISPLAY = () => familyFrom("--font-display", `Georgia, serif`);
const MONO = () => familyFrom("--font-mono", `ui-monospace, monospace`);

/** Paper palette, matching :root in globals.css. */
const PAPER = "#f5efe2";
const PAPER_2 = "#e9dec9";
const INK = "#211c15";
const INK_SOFT = "#5a5142";
const INK_FAINT = "#8a7f6c";
const RULE = "#cdc1a9";

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Word-wrap `text` to at most `maxLines`, ellipsising the tail if needed. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    // Ellipsise the final line if we ran out of room
    let last = lines[maxLines - 1];
    const consumed = lines.join(" ");
    if (consumed.length < text.length) {
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = `${last.trimEnd()}…`;
    }
  }
  return lines;
}

function drawRoute(
  ctx: CanvasRenderingContext2D,
  route: RunStats["route"],
  accent: string,
  box: { x: number; y: number; w: number; h: number }
) {
  if (route.length < 2) {
    ctx.fillStyle = INK_FAINT;
    ctx.font = `500 28px ${MONO()}`;
    ctx.textAlign = "center";
    ctx.fillText("No GPS route recorded", box.x + box.w / 2, box.y + box.h / 2);
    return;
  }
  // Fit the path inside an inset area so the stroke, its glow and the end
  // markers all stay within `box` — no bleed into the header or stats row,
  // however tall or wide the route happens to be.
  const INK = 34; // half stroke (6) + shadow blur (28); dots need only 17.5
  const fit = {
    x: box.x + INK,
    y: box.y + INK,
    w: Math.max(1, box.w - INK * 2),
    h: Math.max(1, box.h - INK * 2),
  };

  const midLat = (route[0].lat + route[route.length - 1].lat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const xs = route.map((p) => p.lon * cosLat);
  const ys = route.map((p) => p.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    fit.w / Math.max(maxX - minX, 1e-9),
    fit.h / Math.max(maxY - minY, 1e-9)
  );
  const usedW = (maxX - minX) * scale;
  const usedH = (maxY - minY) * scale;
  const ox = fit.x + (fit.w - usedW) / 2;
  const oy = fit.y + (fit.h - usedH) / 2;
  const pts = route.map((p, i) => ({
    x: ox + (xs[i] - minX) * scale,
    y: oy + usedH - (ys[i] - minY) * scale, // invert so north is up
  }));

  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = accent;
  ctx.shadowBlur = 28;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();

  const dot = (p: { x: number; y: number }, fill: string) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = PAPER;
    ctx.stroke();
  };
  dot(pts[0], "#3f7d3f");
  dot(pts[pts.length - 1], "#b3271b");
}

/** Treadmill runs have no route — draw a ring of time completed instead. */
function drawTimeRing(
  ctx: CanvasRenderingContext2D,
  stats: RunStats,
  accent: string,
  box: { x: number; y: number; w: number; h: number }
) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = Math.min(box.w, box.h) / 2 - 26;
  const targetMs = (stats.targetMinutes ?? 0) * 60_000;
  const frac = targetMs > 0 ? Math.min(1, stats.elapsedMs / targetMs) : 1;

  ctx.lineWidth = 22;
  ctx.lineCap = "round";
  ctx.strokeStyle = RULE;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.strokeStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 84px ${DISPLAY()}`;
  ctx.fillStyle = INK;
  ctx.fillText(`${Math.round(frac * 100)}%`, cx, cy - 12);
  ctx.font = `500 22px ${MONO()}`;
  ctx.fillStyle = INK_FAINT;
  ctx.fillText("TREADMILL RUN", cx, cy + 52);
}

export interface RunCardOptions {
  persona: Persona;
  stats: RunStats;
  unit: SpeedUnit;
  comment: string;
  date?: Date;
}

export function drawRunCard(canvas: HTMLCanvasElement, opts: RunCardOptions) {
  const { persona, stats, unit, comment } = opts;
  const S = CARD_SIZE;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // ---- background ----
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, S, S);
  // A whisper of the persona's colour, not a glow — on paper this reads as a
  // wash in the stock rather than a light source.
  const wash = ctx.createRadialGradient(S / 2, S * 0.42, 40, S / 2, S * 0.42, S * 0.62);
  wash.addColorStop(0, `${persona.accent}14`);
  wash.addColorStop(1, `${PAPER}00`);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, S, S);

  const PAD = 76;

  // ---- header ----
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `400 54px ${DISPLAY()}`;
  ctx.fillStyle = INK;
  ctx.fillText(persona.emoji, PAD, PAD + 26);

  const date = opts.date ?? new Date();
  const dateText = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  ctx.font = `500 22px ${MONO()}`;
  const dateW = ctx.measureText(dateText).width;
  ctx.textAlign = "right";
  ctx.fillStyle = INK_FAINT;
  ctx.fillText(dateText, S - PAD, PAD + 22);

  // Trim the name if it would run into the date
  const nameX = PAD + 76;
  const nameMax = S - PAD - dateW - 32 - nameX;
  ctx.font = `600 36px ${DISPLAY()}`;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  let name = persona.name;
  if (ctx.measureText(name).width > nameMax) {
    while (name.length > 1 && ctx.measureText(`${name}…`).width > nameMax) {
      name = name.slice(0, -1);
    }
    name = `${name.trimEnd()}…`;
  }
  ctx.fillText(name, nameX, PAD + 22);

  const box = { x: PAD, y: 210, w: S - PAD * 2, h: 400 };
  let cells: { label: string; value: string; unit: string }[];

  if (stats.treadmill) {
    // Indoors there's no route to draw — show progress against the clock.
    drawTimeRing(ctx, stats, persona.accent, box);
    cells = [
      { label: "TIME", value: formatElapsed(stats.elapsedMs), unit: "" },
      {
        label: "TARGET",
        value: String(stats.targetMinutes ?? Math.round(stats.elapsedMs / 60000)),
        unit: "min",
      },
    ];
  } else {
    drawRoute(ctx, stats.route, persona.accent, box);
    const avgSpeedKmh =
      stats.elapsedMs > 0 ? stats.distanceKm / (stats.elapsedMs / 3_600_000) : null;
    cells = [
      { label: "DISTANCE", value: stats.distanceKm.toFixed(2), unit: "km" },
      { label: "TIME", value: formatElapsed(stats.elapsedMs), unit: "" },
      {
        label: unit === "kmh" ? "AVG SPEED" : "AVG PACE",
        value: formatInUnit(avgSpeedKmh, unit),
        unit: unitSuffix(unit),
      },
    ];
  }

  const rowY = 712;
  const colW = (S - PAD * 2) / cells.length;
  const cellMax = colW - 24; // keep a gutter between columns
  ctx.textBaseline = "alphabetic";
  cells.forEach((cell, i) => {
    const cx = PAD + colW * i + colW / 2;

    // Shrink the value (and its unit) until the pair fits its column, so an
    // ultra distance or an hours-long time can never run into its neighbour.
    let valueSize = 72;
    let unitSize = 30;
    let valueW = 0;
    let unitW = 0;
    for (;;) {
      ctx.font = `600 ${valueSize}px ${DISPLAY()}`;
      valueW = ctx.measureText(cell.value).width;
      unitW = 0;
      if (cell.unit) {
        ctx.font = `500 ${unitSize}px ${MONO()}`;
        unitW = ctx.measureText(` ${cell.unit}`).width;
      }
      if (valueW + unitW <= cellMax || valueSize <= 34) break;
      valueSize -= 2;
      unitSize = Math.max(20, Math.round(valueSize * 0.42));
    }

    ctx.fillStyle = INK;
    if (cell.unit) {
      const startX = cx - (valueW + unitW) / 2;
      ctx.textAlign = "left";
      ctx.font = `600 ${valueSize}px ${DISPLAY()}`;
      ctx.fillText(cell.value, startX, rowY);
      ctx.font = `500 ${unitSize}px ${MONO()}`;
      ctx.fillStyle = INK_FAINT;
      ctx.fillText(` ${cell.unit}`, startX + valueW, rowY);
    } else {
      ctx.textAlign = "center";
      ctx.font = `600 ${valueSize}px ${DISPLAY()}`;
      ctx.fillText(cell.value, cx, rowY);
    }

    ctx.textAlign = "center";
    ctx.font = `500 20px ${MONO()}`;
    ctx.fillStyle = INK_FAINT;
    ctx.fillText(cell.label, cx, rowY + 44);
  });

  // ---- coach comment ----
  const boxY = 806;
  const boxH = 158;
  ctx.fillStyle = PAPER_2;
  roundRect(ctx, PAD, boxY, S - PAD * 2, boxH, 4);
  ctx.fill();
  ctx.fillStyle = persona.accent;
  ctx.fillRect(PAD, boxY, 8, boxH);

  ctx.font = `italic 500 32px ${DISPLAY()}`;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, `“${comment}”`, S - PAD * 2 - 80, 3);
  const lineH = 44;
  const startY = boxY + boxH / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => ctx.fillText(line, PAD + 42, startY + i * lineH));

  // ---- footer ----
  ctx.textAlign = "center";
  ctx.font = `600 20px ${MONO()}`;
  ctx.fillStyle = INK_FAINT;
  ctx.fillText("R U N   B U D D Y", S / 2, S - 46);
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/** Share via the iOS share sheet when possible, else fall back to a download. */
export async function shareOrDownloadCard(
  canvas: HTMLCanvasElement,
  filename: string
): Promise<"shared" | "downloaded" | "failed"> {
  const blob = await canvasToBlob(canvas);
  if (!blob) return "failed";
  const file = new File([blob], filename, { type: "image/png" });

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
  };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file] });
      return "shared";
    } catch (err) {
      // User dismissed the sheet — not an error worth reporting
      if (err instanceof DOMException && err.name === "AbortError") return "shared";
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return "downloaded";
  } catch {
    return "failed";
  }
}
