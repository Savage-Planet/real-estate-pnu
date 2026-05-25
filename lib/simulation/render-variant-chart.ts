/**
 * render-variant-chart.ts
 * ========================
 * 12개 variant 비교 SVG 차트 렌더러
 *
 * 두 가지 차트를 단일 SVG에 포함:
 *   1. 막대 그래프: variant별 평균 수렴 라운드 (코사인 ≥ 0.9 도달)
 *   2. 선 그래프: F1, F4, H4, A4 대표 4개 수렴 곡선
 */

// 인터페이스 (run-variant-comparison.ts와 동일)
interface VariantSummary {
  variant: string;
  label: string;
  branch: "flat" | "hierarchy" | "active";
  runs: number;
  reachedCount: number;
  reachRate: number;
  avgReachedRound: number | null;
  medianReachedRound: number | null;
  minReachedRound: number | null;
  maxReachedRound: number | null;
  stdReachedRound: number | null;
  avgMaxCosine: number;
  avgTotalRounds: number;
}

// 색상 팔레트 (branch별)
const BRANCH_COLORS: Record<string, string> = {
  flat:       "#6B9BD2",  // 파란 계열
  hierarchy:  "#5CB85C",  // 초록 계열
  active:     "#E8533A",  // 빨간/오렌지 (A4 강조)
};

const HIGHLIGHT_VARIANTS = new Set(["A4"]);

// 수렴 곡선 색상 (대표 4개)
const CURVE_COLORS: Record<string, string> = {
  F1: "#9BAEC8",
  F4: "#6B9BD2",
  H4: "#5CB85C",
  A4: "#E8533A",
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 12개 variant 막대 그래프 + 4개 수렴 곡선을 단일 SVG로 렌더링.
 *
 * @param summaries  variant별 통계 요약 배열 (길이 12)
 * @param convergenceSeries  대표 4개 variant의 run별 cosineHistory 배열
 */
export function renderVariantChart(
  summaries: VariantSummary[],
  convergenceSeries: Record<string, number[][]>,
): string {
  const SVG_WIDTH = 1100;
  const SVG_HEIGHT = 900;

  // ── 차트 1: 막대 그래프 ─────────────────────────────────
  const BAR_LEFT   = 70;
  const BAR_TOP    = 60;
  const BAR_WIDTH  = SVG_WIDTH - 120;
  const BAR_HEIGHT = 340;

  const n = summaries.length;
  const barW = Math.floor(BAR_WIDTH / n) - 6;
  const maxRound = Math.max(
    ...summaries.map((s) => s.avgReachedRound ?? s.avgTotalRounds),
    40,
  );
  const yScale = BAR_HEIGHT / maxRound;

  // Y축 눈금 (0, 25, 50, 75, 100, ...)
  const yTicks: number[] = [];
  const tickStep = maxRound <= 60 ? 10 : maxRound <= 120 ? 25 : 50;
  for (let v = 0; v <= maxRound; v += tickStep) yTicks.push(v);

  let barSvg = "";

  // Y축 눈금선 + 레이블
  for (const t of yTicks) {
    const y = BAR_TOP + BAR_HEIGHT - t * yScale;
    barSvg += `<line x1="${BAR_LEFT}" y1="${y}" x2="${BAR_LEFT + BAR_WIDTH}" y2="${y}" stroke="#e0e0e0" stroke-width="1"/>`;
    barSvg += `<text x="${BAR_LEFT - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="#666">${t}</text>`;
  }

  // 막대
  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i];
    const x = BAR_LEFT + i * (barW + 6) + 3;
    const avgR = s.avgReachedRound ?? s.avgTotalRounds;
    const barH = Math.max(2, avgR * yScale);
    const y = BAR_TOP + BAR_HEIGHT - barH;
    const color = HIGHLIGHT_VARIANTS.has(s.variant)
      ? "#E8533A"
      : BRANCH_COLORS[s.branch] ?? "#aaa";
    const opacity = s.reachedCount === 0 ? 0.4 : 1.0;

    barSvg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" opacity="${opacity}" rx="2"/>`;

    // 도달률 표시 (막대 위)
    const rateStr = (s.reachRate * 100).toFixed(0) + "%";
    barSvg += `<text x="${x + barW / 2}" y="${y - 4}" font-size="9" text-anchor="middle" fill="${color}">${rateStr}</text>`;

    // 평균 라운드 수치
    if (s.avgReachedRound !== null) {
      const valStr = s.avgReachedRound.toFixed(1);
      barSvg += `<text x="${x + barW / 2}" y="${y - 14}" font-size="9" text-anchor="middle" fill="${color}">${valStr}</text>`;
    }

    // X축 레이블 (variant ID)
    barSvg += `<text x="${x + barW / 2}" y="${BAR_TOP + BAR_HEIGHT + 16}" font-size="11" text-anchor="middle" fill="${HIGHLIGHT_VARIANTS.has(s.variant) ? "#E8533A" : "#333"}" font-weight="${HIGHLIGHT_VARIANTS.has(s.variant) ? "bold" : "normal"}">${s.variant}</text>`;
  }

  // 표준편차 오차막대
  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i];
    if (s.avgReachedRound === null || s.stdReachedRound === null) continue;
    const x = BAR_LEFT + i * (barW + 6) + 3 + barW / 2;
    const avgR = s.avgReachedRound;
    const std = s.stdReachedRound;
    const yMid = BAR_TOP + BAR_HEIGHT - avgR * yScale;
    const yTop = Math.max(BAR_TOP, yMid - std * yScale);
    const yBot = Math.min(BAR_TOP + BAR_HEIGHT, yMid + std * yScale);
    barSvg += `<line x1="${x}" y1="${yTop}" x2="${x}" y2="${yBot}" stroke="#555" stroke-width="1.5"/>`;
    barSvg += `<line x1="${x - 4}" y1="${yTop}" x2="${x + 4}" y2="${yTop}" stroke="#555" stroke-width="1.5"/>`;
    barSvg += `<line x1="${x - 4}" y1="${yBot}" x2="${x + 4}" y2="${yBot}" stroke="#555" stroke-width="1.5"/>`;
  }

  // ── 차트 2: 수렴 곡선 ───────────────────────────────────
  const CURVE_LEFT   = 70;
  const CURVE_TOP    = BAR_TOP + BAR_HEIGHT + 90;
  const CURVE_WIDTH  = SVG_WIDTH - 120;
  const CURVE_HEIGHT = 280;

  // 최대 라운드 수 (모든 수렴 히스토리 길이)
  const allHistories = Object.values(convergenceSeries).flat();
  const maxX = Math.max(...allHistories.map((h) => h.length), 40);

  const xScale = CURVE_WIDTH / maxX;
  const yMin = 0;
  const yMax = 1.0;
  const yRange = yMax - yMin;

  let curveSvg = "";

  // Y축 눈금
  for (const yv of [0, 0.2, 0.4, 0.6, 0.8, 0.9, 1.0]) {
    const y = CURVE_TOP + CURVE_HEIGHT - ((yv - yMin) / yRange) * CURVE_HEIGHT;
    const isTarget = Math.abs(yv - 0.9) < 0.001;
    curveSvg += `<line x1="${CURVE_LEFT}" y1="${y}" x2="${CURVE_LEFT + CURVE_WIDTH}" y2="${y}" stroke="${isTarget ? "#E8533A" : "#e0e0e0"}" stroke-width="${isTarget ? 1.5 : 1}" stroke-dasharray="${isTarget ? "6,3" : ""}"/>`;
    curveSvg += `<text x="${CURVE_LEFT - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="${isTarget ? "#E8533A" : "#666"}">${yv.toFixed(1)}</text>`;
  }
  // 0.9 기준선 레이블
  {
    const y = CURVE_TOP + CURVE_HEIGHT - ((0.9 - yMin) / yRange) * CURVE_HEIGHT;
    curveSvg += `<text x="${CURVE_LEFT + CURVE_WIDTH + 4}" y="${y + 4}" font-size="10" fill="#E8533A">목표 0.9</text>`;
  }

  // X축 눈금
  for (let xv = 0; xv <= maxX; xv += Math.ceil(maxX / 8)) {
    const x = CURVE_LEFT + xv * xScale;
    curveSvg += `<line x1="${x}" y1="${CURVE_TOP}" x2="${x}" y2="${CURVE_TOP + CURVE_HEIGHT}" stroke="#e0e0e0" stroke-width="1"/>`;
    curveSvg += `<text x="${x}" y="${CURVE_TOP + CURVE_HEIGHT + 16}" font-size="11" text-anchor="middle" fill="#666">${xv}</text>`;
  }

  // 수렴 곡선 (각 variant의 평균 곡선만 그림)
  for (const [variantId, runs] of Object.entries(convergenceSeries)) {
    if (runs.length === 0) continue;
    const color = CURVE_COLORS[variantId] ?? "#aaa";

    // 평균 곡선 계산 (각 라운드별 평균)
    const maxLen = Math.max(...runs.map((r) => r.length));
    const avgHistory: number[] = [];
    for (let t = 0; t < maxLen; t++) {
      const vals = runs.map((r) => r[t] ?? r[r.length - 1] ?? 0);
      avgHistory.push(vals.reduce((s, v) => s + v, 0) / vals.length);
    }

    // 개별 run 희미하게
    for (const history of runs) {
      const pts = history
        .map((v, t) => {
          const x = CURVE_LEFT + t * xScale;
          const y = CURVE_TOP + CURVE_HEIGHT - ((v - yMin) / yRange) * CURVE_HEIGHT;
          return `${x},${y}`;
        })
        .join(" ");
      curveSvg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.3"/>`;
    }

    // 평균 곡선 (굵게)
    const avgPts = avgHistory
      .map((v, t) => {
        const x = CURVE_LEFT + t * xScale;
        const y = CURVE_TOP + CURVE_HEIGHT - ((v - yMin) / yRange) * CURVE_HEIGHT;
        return `${x},${y}`;
      })
      .join(" ");
    const isHighlight = variantId === "A4";
    curveSvg += `<polyline points="${avgPts}" fill="none" stroke="${color}" stroke-width="${isHighlight ? 2.5 : 1.8}" opacity="0.95"/>`;

    // 레이블 (끝점)
    const lastV = avgHistory[avgHistory.length - 1] ?? 0;
    const lx = CURVE_LEFT + (avgHistory.length - 1) * xScale;
    const ly = CURVE_TOP + CURVE_HEIGHT - ((lastV - yMin) / yRange) * CURVE_HEIGHT;
    curveSvg += `<text x="${lx + 4}" y="${ly + 4}" font-size="11" fill="${color}" font-weight="${isHighlight ? "bold" : "normal"}">${variantId}</text>`;
  }

  // ── 브랜치 범례 ─────────────────────────────────────────
  const legendX = BAR_LEFT;
  const legendY = BAR_TOP - 30;
  const legendItems = [
    { color: BRANCH_COLORS.flat,       label: "Branch 1: Flat Bayesian (F1-F4)" },
    { color: BRANCH_COLORS.hierarchy,  label: "Branch 2: Simple Hierarchy (H1-H4)" },
    { color: BRANCH_COLORS.active,     label: "Branch 3: Active Query Hierarchy (A1-A4) ← 현재 모델" },
  ];

  let legendSvg = "";
  let lx = legendX;
  for (const item of legendItems) {
    legendSvg += `<rect x="${lx}" y="${legendY - 8}" width="14" height="10" fill="${item.color}" rx="2"/>`;
    legendSvg += `<text x="${lx + 18}" y="${legendY}" font-size="11" fill="#333">${escapeXml(item.label)}</text>`;
    lx += item.label.length * 6.5 + 24;
  }

  // ── SVG 조립 ─────────────────────────────────────────────
  const titleSvg = `<text x="${SVG_WIDTH / 2}" y="28" font-size="16" text-anchor="middle" fill="#222" font-weight="bold">모델 변형별 수렴 성능 비교 (코사인 유사도 ≥ ${0.9} 도달 라운드)</text>`;

  const subtitle1 = `<text x="${BAR_LEFT}" y="${BAR_TOP - 42}" font-size="13" fill="#555" font-weight="bold">막대 그래프: 평균 수렴 라운드 (오차막대=±1σ, 투명=미도달 variant)</text>`;
  const subtitle2 = `<text x="${CURVE_LEFT}" y="${CURVE_TOP - 14}" font-size="13" fill="#555" font-weight="bold">수렴 곡선: 대표 4개 variant (F1, F4, H4, A4) 코사인 유사도 추이</text>`;

  const axisLabel1 = `<text x="${BAR_LEFT + BAR_WIDTH / 2}" y="${BAR_TOP + BAR_HEIGHT + 36}" font-size="12" text-anchor="middle" fill="#555">모델 변형</text>`;
  const axisLabel2 = `<text transform="rotate(-90)" x="${-(BAR_TOP + BAR_HEIGHT / 2)}" y="${BAR_LEFT - 44}" font-size="12" text-anchor="middle" fill="#555">평균 수렴 라운드</text>`;
  const axisLabel3 = `<text x="${CURVE_LEFT + CURVE_WIDTH / 2}" y="${CURVE_TOP + CURVE_HEIGHT + 32}" font-size="12" text-anchor="middle" fill="#555">비교 라운드 수</text>`;
  const axisLabel4 = `<text transform="rotate(-90)" x="${-(CURVE_TOP + CURVE_HEIGHT / 2)}" y="${CURVE_LEFT - 44}" font-size="12" text-anchor="middle" fill="#555">코사인 유사도</text>`;

  // 축 테두리
  const border1 = `<rect x="${BAR_LEFT}" y="${BAR_TOP}" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" fill="none" stroke="#ccc" stroke-width="1"/>`;
  const border2 = `<rect x="${CURVE_LEFT}" y="${CURVE_TOP}" width="${CURVE_WIDTH}" height="${CURVE_HEIGHT}" fill="none" stroke="#ccc" stroke-width="1"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">
  <defs>
    <style>
      text { font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; }
    </style>
  </defs>
  <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="white"/>
  ${titleSvg}
  ${legendSvg}
  ${subtitle1}
  ${border1}
  ${barSvg}
  ${axisLabel1}
  ${axisLabel2}
  ${subtitle2}
  ${border2}
  ${curveSvg}
  ${axisLabel3}
  ${axisLabel4}
</svg>`;
}
