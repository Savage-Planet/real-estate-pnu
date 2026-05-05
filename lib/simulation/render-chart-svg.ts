import type { SimulationResult } from "./run-simulation";

const W = 800;
const H = 400;
const PAD = { top: 30, right: 80, bottom: 50, left: 60 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

interface LineDef {
  key: string;
  color: string;
  label: string;
  getValue: (d: SimulationResult["series"][0]) => number;
  dash?: string;
}

const LINES: LineDef[] = [
  { key: "concentration", color: "#10b981", label: "사후분포 집중도", getValue: (d) => d.concentration },
  { key: "topKStability", color: "#f59e0b", label: "Top-K 안정도", getValue: (d) => d.topKStability, dash: "6,3" },
  { key: "cosine", color: "#ef4444", label: "코사인 유사도(w*)", getValue: (d) => d.cosineToHidden, dash: "2,2" },
];

function toPath(
  data: SimulationResult["series"],
  getValue: (d: SimulationResult["series"][0]) => number,
  maxRound: number,
  yMax: number,
): string {
  return data
    .map((d, i) => {
      const x = PAD.left + (d.round / maxRound) * plotW;
      const val = Math.min(getValue(d), yMax);
      const y = PAD.top + plotH - (val / yMax) * plotH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join("");
}

export function renderChartSvg(result: SimulationResult): string {
  const { series, meta } = result;
  if (series.length === 0) return "<svg/>";

  const maxRound = series[series.length - 1].round;
  const yMax = 1.05;

  const yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  const xStep = Math.max(1, Math.ceil(maxRound / 10));
  const xTicks: number[] = [];
  for (let r = xStep; r <= maxRound; r += xStep) xTicks.push(r);
  if (xTicks[xTicks.length - 1] !== maxRound) xTicks.push(maxRound);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif">\n`;
  svg += `<rect width="${W}" height="${H}" fill="#fafafa"/>\n`;

  svg += `<text x="${W / 2}" y="18" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">수렴 시뮬레이션 (매물 ${meta.candidateCount}개, 코사인 목표 ${meta.hiddenMatchCosine})</text>\n`;

  for (const v of yTicks) {
    const y = PAD.top + plotH - (v / yMax) * plotH;
    svg += `<line x1="${PAD.left}" x2="${PAD.left + plotW}" y1="${y}" y2="${y}" stroke="#e0e0e0" stroke-width="0.5"/>\n`;
    svg += `<text x="${PAD.left - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#888">${v.toFixed(1)}</text>\n`;
  }

  for (const r of xTicks) {
    const x = PAD.left + (r / maxRound) * plotW;
    svg += `<text x="${x}" y="${H - PAD.bottom + 18}" text-anchor="middle" font-size="10" fill="#888">${r}</text>\n`;
  }
  svg += `<text x="${PAD.left + plotW / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#666">비교 라운드</text>\n`;

  for (const line of LINES) {
    const path = toPath(series, line.getValue, maxRound, yMax);
    const dashAttr = line.dash ? ` stroke-dasharray="${line.dash}"` : "";
    svg += `<path d="${path}" fill="none" stroke="${line.color}" stroke-width="1.8"${dashAttr} stroke-linecap="round" stroke-linejoin="round"/>\n`;
  }

  if (meta.cosineReachedRound != null) {
    const x = PAD.left + (meta.cosineReachedRound / maxRound) * plotW;
    svg += `<line x1="${x}" x2="${x}" y1="${PAD.top}" y2="${PAD.top + plotH}" stroke="#ef4444" stroke-width="1" stroke-dasharray="4,3"/>\n`;
    svg += `<text x="${x + 3}" y="${PAD.top + 12}" font-size="9" fill="#ef4444">cos≥${meta.hiddenMatchCosine} @${meta.cosineReachedRound}회</text>\n`;
  }

  if (meta.cosineMaxRound > 0) {
    const x = PAD.left + (meta.cosineMaxRound / maxRound) * plotW;
    const val = Math.min(meta.cosineMaxValue, yMax);
    const y = PAD.top + plotH - (val / yMax) * plotH;
    svg += `<circle cx="${x}" cy="${y}" r="4" fill="#ef4444" stroke="#fff" stroke-width="1.5"/>\n`;
    svg += `<text x="${x + 6}" y="${y - 4}" font-size="9" fill="#ef4444" font-weight="bold">max cos=${meta.cosineMaxValue.toFixed(4)} @${meta.cosineMaxRound}회</text>\n`;
  }

  if (meta.convergenceRound != null) {
    const x = PAD.left + (meta.convergenceRound / maxRound) * plotW;
    svg += `<line x1="${x}" x2="${x}" y1="${PAD.top}" y2="${PAD.top + plotH}" stroke="#6366f1" stroke-width="1" stroke-dasharray="4,3"/>\n`;
    svg += `<text x="${x + 3}" y="${PAD.top + 24}" font-size="9" fill="#6366f1">수렴 @${meta.convergenceRound}회</text>\n`;
  }

  const legendY = PAD.top;
  const legendX = PAD.left + plotW + 8;
  for (let i = 0; i < LINES.length; i++) {
    const line = LINES[i];
    const y = legendY + i * 18;
    const dashAttr = line.dash ? ` stroke-dasharray="${line.dash}"` : "";
    svg += `<line x1="${legendX}" x2="${legendX + 16}" y1="${y}" y2="${y}" stroke="${line.color}" stroke-width="2"${dashAttr}/>\n`;
    svg += `<text x="${legendX + 20}" y="${y + 4}" font-size="9" fill="#555">${line.label}</text>\n`;
  }

  svg += `</svg>`;
  return svg;
}
