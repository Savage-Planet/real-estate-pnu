/**
 * run-virtual-comparison.ts
 * ==========================
 * 가상 아이템(Virtual Item) 유무 비교 실험
 *
 * 비교 대상:
 *   - H3: 가상 아이템 없음  (실제 매물 비교만)
 *   - H4: 단순 가상 아이템  (HIGH/LOW 아키타입)
 *   - A3: Trade-off 가상 쌍 (Sadigh 2017 C(4,2) 6쌍)
 *
 * 출력:
 *   out/simulation/virtual-comparison.json
 *   out/simulation/virtual-comparison-curve.svg
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { fetchRealData } from "../lib/simulation/fetch-real-data";
import { runHierarchicalSim, generateHierarchicalHiddenWeight } from "../lib/simulation/run-hierarchical-sim";
import { getVariantById } from "../lib/simulation/variant-configs";

dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });

const RUNS = parseInt(process.argv[2] ?? "50", 10);
const COSINE_TARGET = 0.9;
const BUILDING_ID = process.argv[3] ?? undefined;

// 비교할 3개 variant
const TARGETS = ["H3", "H4", "A3"] as const;

const COLORS: Record<string, string> = {
  H3: "#9BAEC8",   // 회청색
  H4: "#5CB85C",   // 초록
  A3: "#E8533A",   // 빨강
};

const TARGET_LABELS: Record<string, string> = {
  H3: "H3: 가상 아이템 없음",
  H4: "H4: 단순 가상 아이템 (HIGH/LOW)",
  A3: "A3: Trade-off 가상 쌍 (Sadigh 2017)",
};

// ──────────────────────────────────────────────────────────
// 결과 집계
// ──────────────────────────────────────────────────────────

interface RunRecord {
  variant: string;
  run: number;
  cosineReachedRound: number | null;
  totalRounds: number;
  cosineMaxValue: number;
  cosineHistory: number[];
}

interface Summary {
  variant: string;
  label: string;
  runs: number;
  reachedCount: number;
  reachRate: number;
  avgReachedRound: number | null;
  medianReachedRound: number | null;
  avgMaxCosine: number;
}

function computeSummary(variant: string, records: RunRecord[]): Summary {
  const reached = records.filter(r => r.cosineReachedRound !== null);
  const rounds = reached.map(r => r.cosineReachedRound!).sort((a, b) => a - b);
  return {
    variant,
    label: TARGET_LABELS[variant],
    runs: records.length,
    reachedCount: reached.length,
    reachRate: reached.length / records.length,
    avgReachedRound: rounds.length > 0
      ? rounds.reduce((s, v) => s + v, 0) / rounds.length
      : null,
    medianReachedRound: rounds.length > 0
      ? rounds[Math.floor(rounds.length / 2)]
      : null,
    avgMaxCosine: records.reduce((s, r) => s + r.cosineMaxValue, 0) / records.length,
  };
}

// ──────────────────────────────────────────────────────────
// SVG 수렴 곡선 생성
// ──────────────────────────────────────────────────────────

function renderComparisonSVG(
  allRecords: RunRecord[],
  summaries: Summary[],
): string {
  const W = 900;
  const H = 520;
  const LEFT = 70;
  const TOP = 50;
  const CW = W - 130;
  const CH = 340;

  const maxX = 55; // x축 최대 라운드
  const xScale = CW / maxX;
  const yScale = CH / 1.0;

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><style>text { font-family: "Malgun Gothic","Apple SD Gothic Neo",sans-serif; }</style></defs>
<rect width="${W}" height="${H}" fill="white"/>`;

  // 제목
  svg += `<text x="${W / 2}" y="30" font-size="15" text-anchor="middle" fill="#222" font-weight="bold">가상 아이템 유무에 따른 수렴 속도 비교</text>`;

  // 격자
  for (const yv of [0, 0.2, 0.4, 0.6, 0.8, 0.9, 1.0]) {
    const y = TOP + CH - yv * yScale;
    const isTarget = Math.abs(yv - 0.9) < 0.001;
    svg += `<line x1="${LEFT}" y1="${y}" x2="${LEFT + CW}" y2="${y}"
      stroke="${isTarget ? "#E8533A" : "#e0e0e0"}"
      stroke-width="${isTarget ? 1.5 : 1}"
      stroke-dasharray="${isTarget ? "6,3" : ""}"/>`;
    svg += `<text x="${LEFT - 6}" y="${y + 4}" font-size="11" text-anchor="end" fill="${isTarget ? "#E8533A" : "#666"}">${yv.toFixed(1)}</text>`;
  }
  const yLabel0 = TOP + CH - 0.9 * yScale;
  svg += `<text x="${LEFT + CW + 4}" y="${yLabel0 + 4}" font-size="10" fill="#E8533A">목표 0.9</text>`;

  for (let xv = 0; xv <= maxX; xv += 10) {
    const x = LEFT + xv * xScale;
    svg += `<line x1="${x}" y1="${TOP}" x2="${x}" y2="${TOP + CH}" stroke="#e0e0e0" stroke-width="1"/>`;
    svg += `<text x="${x}" y="${TOP + CH + 16}" font-size="11" text-anchor="middle" fill="#666">${xv}</text>`;
  }

  // 축 테두리
  svg += `<rect x="${LEFT}" y="${TOP}" width="${CW}" height="${CH}" fill="none" stroke="#ccc" stroke-width="1"/>`;

  // 각 variant: 개별 run (희미) + 평균 (굵게)
  for (const variant of TARGETS) {
    const color = COLORS[variant];
    const records = allRecords.filter(r => r.variant === variant);
    if (records.length === 0) continue;

    // 개별 run (희미)
    for (const rec of records) {
      const pts = rec.cosineHistory.slice(0, maxX).map((v, t) => {
        const x = LEFT + t * xScale;
        const y = TOP + CH - v * yScale;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ");
      if (pts) svg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="0.6" opacity="0.25"/>`;
    }

    // 평균 곡선
    const maxLen = Math.min(maxX, Math.max(...records.map(r => r.cosineHistory.length)));
    const avg: number[] = [];
    for (let t = 0; t < maxLen; t++) {
      const vals = records.map(r => r.cosineHistory[t] ?? r.cosineHistory[r.cosineHistory.length - 1] ?? 0);
      avg.push(vals.reduce((s, v) => s + v, 0) / vals.length);
    }
    const avgPts = avg.map((v, t) => {
      const x = LEFT + t * xScale;
      const y = TOP + CH - v * yScale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    if (avgPts) {
      svg += `<polyline points="${avgPts}" fill="none" stroke="${color}" stroke-width="2.5" opacity="0.95"/>`;
    }
  }

  // 범례 + 통계 박스
  let ly = TOP + CH + 45;
  svg += `<text x="${LEFT}" y="${ly}" font-size="12" fill="#333" font-weight="bold">범례 및 결과:</text>`;
  ly += 20;

  for (const s of summaries) {
    const color = COLORS[s.variant];
    svg += `<rect x="${LEFT}" y="${ly - 9}" width="14" height="10" fill="${color}" rx="2"/>`;
    const rateStr = (s.reachRate * 100).toFixed(0) + "%";
    const avgStr = s.avgReachedRound != null ? s.avgReachedRound.toFixed(1) + "회" : "미달성";
    svg += `<text x="${LEFT + 18}" y="${ly}" font-size="11" fill="#333">${s.label}</text>`;
    svg += `<text x="${LEFT + 18}" y="${ly + 14}" font-size="11" fill="${color}" font-weight="bold">  도달률: ${rateStr}   수렴 라운드: ${avgStr}   최대 코사인: ${s.avgMaxCosine.toFixed(3)}</text>`;
    ly += 36;
  }

  // 축 레이블
  svg += `<text x="${LEFT + CW / 2}" y="${TOP + CH + 32}" font-size="12" text-anchor="middle" fill="#555">비교 라운드 수</text>`;
  svg += `<text transform="rotate(-90)" x="${-(TOP + CH / 2)}" y="${LEFT - 44}" font-size="12" text-anchor="middle" fill="#555">코사인 유사도</text>`;

  svg += `</svg>`;
  return svg;
}

// ──────────────────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────────────────

async function main() {
  console.log("=== 가상 아이템 비교 실험 ===");
  console.log(`  비교 variant: H3 (없음) / H4 (단순) / A3 (Trade-off)`);
  console.log(`  반복 횟수: ${RUNS}회`);
  console.log(`  코사인 목표: ${COSINE_TARGET}`);
  console.log();

  console.log("Supabase에서 데이터 불러오는 중...");
  const { properties, building, stats, commuteById } = await fetchRealData(BUILDING_ID);
  console.log(`  매물 ${properties.length}개, 건물: ${building.name}`);
  console.log();

  const allRecords: RunRecord[] = [];
  const t0 = Date.now();

  for (const variantId of TARGETS) {
    const cfg = getVariantById(variantId);
    console.log(`▶ ${variantId} (${TARGET_LABELS[variantId]}) — ${RUNS}회 실행 중...`);

    for (let i = 1; i <= RUNS; i++) {
      const hiddenW = generateHierarchicalHiddenWeight();
      let record: RunRecord;
      try {
        const result = runHierarchicalSim(cfg, properties, stats, commuteById, COSINE_TARGET, hiddenW);
        record = {
          variant: variantId,
          run: i,
          cosineReachedRound: result.cosineReachedRound,
          totalRounds: result.totalRounds,
          cosineMaxValue: result.cosineMaxValue,
          cosineHistory: result.cosineHistory,
        };
      } catch (e) {
        console.error(`  [${variantId}] run ${i} 실패:`, e);
        record = { variant: variantId, run: i, cosineReachedRound: null, totalRounds: 52, cosineMaxValue: 0, cosineHistory: [] };
      }
      allRecords.push(record);

      const tag = record.cosineReachedRound != null
        ? `cos≥${COSINE_TARGET} @${record.cosineReachedRound}회`
        : `미도달 (max=${record.cosineMaxValue.toFixed(3)})`;
      process.stdout.write(`  [${String(i).padStart(2)}/${RUNS}] ${tag}\n`);
    }

    const records = allRecords.filter(r => r.variant === variantId);
    const s = computeSummary(variantId, records);
    console.log(`  → 도달률: ${(s.reachRate * 100).toFixed(1)}%  평균 라운드: ${s.avgReachedRound?.toFixed(1) ?? "N/A"}  최대 cos: ${s.avgMaxCosine.toFixed(4)}`);
    console.log();
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`총 실행 시간: ${elapsed}초`);

  // 요약 집계
  const summaries = TARGETS.map(v => computeSummary(v, allRecords.filter(r => r.variant === v)));

  console.log("\n══════════════════════════════════════════");
  console.log("가상 아이템 유무 비교 결과");
  console.log("══════════════════════════════════════════");
  for (const s of summaries) {
    const rateStr = (s.reachRate * 100).toFixed(1) + "%";
    const avgStr = s.avgReachedRound?.toFixed(1) ?? "N/A";
    console.log(`${s.variant.padEnd(3)}: 도달률 ${rateStr.padStart(6)}  평균 ${avgStr.padStart(6)}회  최대cos ${s.avgMaxCosine.toFixed(4)}`);
  }

  // 파일 저장
  const outDir = path.resolve(__dirname, "..", "out", "simulation");
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "virtual-comparison.json");
  fs.writeFileSync(jsonPath, JSON.stringify({ summaries, records: allRecords }, null, 2), "utf-8");
  console.log(`\n  JSON → ${jsonPath}`);

  const svgPath = path.join(outDir, "virtual-comparison-curve.svg");
  fs.writeFileSync(svgPath, renderComparisonSVG(allRecords, summaries), "utf-8");
  console.log(`  SVG  → ${svgPath}`);
  console.log("\n완료!");
}

main().catch(e => { console.error(e); process.exit(1); });
