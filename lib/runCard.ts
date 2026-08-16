import { formatElapsed } from "./geo";
import { formatInUnit, unitSuffix, type SpeedUnit } from "./units";
import type { Persona, RunStats } from "./types";

// Renders the end-of-run infographic: a square 1080×1080 PNG with the route,
// the headline numbers and the coach's closing line. Drawn on a canvas so it
// can be saved to Photos / shared straight from the summary screen.

export const CARD_SIZE = 1080;

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;

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
    ctx.fillStyle = "rgba(235,235,245,0.25)";
    ctx.font = `500 30px ${FONT}`;
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
    ctx.strokeStyle = "#0b0b0d";
    ctx.stroke();
  };
  dot(pts[0], "#30d158");
  dot(pts[pts.length - 1], "#ff453a");
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
  ctx.fillStyle = "#0b0b0d";
  ctx.fillRect(0, 0, S, S);
  const glow = ctx.createRadialGradient(S / 2, S * 0.42, 40, S / 2, S * 0.42, S * 0.62);
  glow.addColorStop(0, `${persona.accent}26`);
  glow.addColorStop(1, "#0b0b0d00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  const PAD = 76;

  // ---- header ----
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `400 54px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(persona.emoji, PAD, PAD + 26);

  const date = opts.date ?? new Date();
  const dateText = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  ctx.font = `600 28px ${FONT}`;
  const dateW = ctx.measureText(dateText).width;
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(235,235,245,0.6)";
  ctx.fillText(dateText, S - PAD, PAD + 22);

  // Trim the name if it would run into the date
  const nameX = PAD + 76;
  const nameMax = S - PAD - dateW - 32 - nameX;
  ctx.font = `700 34px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  let name = persona.name;
  if (ctx.measureText(name).width > nameMax) {
    while (name.length > 1 && ctx.measureText(`${name}…`).width > nameMax) {
      name = name.slice(0, -1);
    }
    name = `${name.trimEnd()}…`;
  }
  ctx.fillText(name, nameX, PAD + 22);

  // ---- route ----
  drawRoute(ctx, stats.route, persona.accent, {
    x: PAD,
    y: 210,
    w: S - PAD * 2,
    h: 400,
  });

  // ---- stats row ----
  const avgSpeedKmh =
    stats.elapsedMs > 0 ? stats.distanceKm / (stats.elapsedMs / 3_600_000) : null;
  const cells: { label: string; value: string; unit: string }[] = [
    { label: "DISTANCE", value: stats.distanceKm.toFixed(2), unit: "km" },
    { label: "TIME", value: formatElapsed(stats.elapsedMs), unit: "" },
    {
      label: unit === "kmh" ? "AVG SPEED" : "AVG PACE",
      value: formatInUnit(avgSpeedKmh, unit),
      unit: unitSuffix(unit),
    },
  ];

  const rowY = 712;
  const colW = (S - PAD * 2) / 3;
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
      ctx.font = `700 ${valueSize}px ${FONT}`;
      valueW = ctx.measureText(cell.value).width;
      unitW = 0;
      if (cell.unit) {
        ctx.font = `600 ${unitSize}px ${FONT}`;
        unitW = ctx.measureText(` ${cell.unit}`).width;
      }
      if (valueW + unitW <= cellMax || valueSize <= 34) break;
      valueSize -= 2;
      unitSize = Math.max(20, Math.round(valueSize * 0.42));
    }

    ctx.fillStyle = "#ffffff";
    if (cell.unit) {
      const startX = cx - (valueW + unitW) / 2;
      ctx.textAlign = "left";
      ctx.font = `700 ${valueSize}px ${FONT}`;
      ctx.fillText(cell.value, startX, rowY);
      ctx.font = `600 ${unitSize}px ${FONT}`;
      ctx.fillStyle = "rgba(235,235,245,0.6)";
      ctx.fillText(` ${cell.unit}`, startX + valueW, rowY);
    } else {
      ctx.textAlign = "center";
      ctx.font = `700 ${valueSize}px ${FONT}`;
      ctx.fillText(cell.value, cx, rowY);
    }

    ctx.textAlign = "center";
    ctx.font = `700 24px ${FONT}`;
    ctx.fillStyle = "rgba(235,235,245,0.5)";
    ctx.fillText(cell.label, cx, rowY + 44);
  });

  // ---- coach comment ----
  const boxY = 806;
  const boxH = 158;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  roundRect(ctx, PAD, boxY, S - PAD * 2, boxH, 28);
  ctx.fill();
  ctx.fillStyle = persona.accent;
  roundRect(ctx, PAD, boxY, 8, boxH, 4);
  ctx.fill();

  ctx.font = `italic 500 32px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, `“${comment}”`, S - PAD * 2 - 80, 3);
  const lineH = 44;
  const startY = boxY + boxH / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => ctx.fillText(line, PAD + 42, startY + i * lineH));

  // ---- footer ----
  ctx.textAlign = "center";
  ctx.font = `800 26px ${FONT}`;
  ctx.fillStyle = "rgba(235,235,245,0.35)";
  ctx.fillText("RUN BUDDY", S / 2, S - 46);
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
