/**
 * run-variant-comparison.ts
 * ==========================
 * 12개 모델 변형 × 20회 배치 시뮬레이션 실행
 *
 * 출력:
 *   out/simulation/variant-comparison.json  — 전체 raw 데이터
 *   out/simulation/variant-summary.csv      — variant별 통계 요약
 *   out/simulation/variant-chart.svg        — 막대 그래프
 *
 * 사용법:
 *   npx ts-node scripts/run-variant-comparison.ts [RUNS] [COSINE_TARGET] [BUILDING_ID]
 *
 * 예시:
 *   npx ts-node scripts/run-variant-comparison.ts 20 0.9
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { fetchRealData } from "../lib/simulation/fetch-real-data";
import { runSimulation, type SimulationConfig } from "../lib/simulation/run-simulation";
import { runHierarchicalSim, generateHierarchicalHiddenWeight } from "../lib/simulation/run-hierarchical-sim";
import { VARIANT_CONFIGS, type VariantConfig } from "../lib/simulation/variant-configs";
import { renderVariantChart } from "../lib/simulation/render-variant-chart";
import type { FeatureVector } from "../lib/feature-engineer";

dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });

const RUNS = parseInt(process.argv[2] ?? "20", 10);
const COSINE_TARGET = parseFloat(process.argv[3] ?? "0.85");
const ABSOLUTE_MAX = parseInt(process.argv[4] ?? "200", 10);
const BUILDING_ID = process.argv[5] ?? undefined;

// ──────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────

interface RunRecord {
  variant: string;
  run: number;
  cosineReachedRound: number | null;
  totalRounds: number;
  cosineMaxValue: number;
  cosineHistory: number[];
}

interface VariantSummary {
  variant: string;
  label: string;
  branch: "flat" | "hierarchy" | "active";
  runs: number;
  reachedCount: number;
  reachRate: number;        // 0~1
  /**
   * 전체 run 평균 달성 횟수.
   * 0.85에 도달한 run은 cosineReachedRound, 미도달 run은 totalRounds(최대) 사용.
   * 항상 number (null 없음).
   */
  avgReachedRound: number;
  medianReachedRound: number | null;
  minReachedRound: number | null;
  maxReachedRound: number | null;
  stdReachedRound: number | null;
  avgMaxCosine: number;
  avgTotalRounds: number;
}

// ──────────────────────────────────────────────────────────
// 단일 run 실행
// ──────────────────────────────────────────────────────────

/**
 * 계층적으로 구조화된 히든 가중치 생성 (공정 비교용)
 * 모든 variant가 동일한 히든 가중치 구조를 학습하도록 함.
 * Flat 모델도 hierarchically-structured weight를 학습하므로 비교 공정성 보장.
 */
function sharedHiddenWeight(): FeatureVector {
  return generateHierarchicalHiddenWeight();
}

function runOneFlat(
  cfg: VariantConfig,
  properties: Parameters<typeof runSimulation>[1],
  stats: Parameters<typeof runSimulation>[2],
  commuteById: Parameters<typeof runSimulation>[3],
  hiddenW: FeatureVector,
): RunRecord {
  const simConfig: SimulationConfig = {
    candidateCount: properties.length,
    minRounds: 5,
    absoluteMaxRounds: ABSOLUTE_MAX,
    hiddenMatchCosine: COSINE_TARGET,
    silent: true,
    queryMode: cfg.queryMode as "random" | "evr",
    usePrior: cfg.usePrior,
    useBwm: cfg.useBwm,
    hiddenWeightOverride: hiddenW,
  };
  const result = runSimulation(simConfig, properties, stats, commuteById);
  return {
    variant: cfg.id,
    run: 0,
    cosineReachedRound: result.meta.cosineReachedRound,
    totalRounds: result.meta.totalRounds,
    cosineMaxValue: result.meta.cosineMaxValue,
    cosineHistory: result.series.map((s) => s.cosineToHidden),
  };
}

function runOneHier(
  cfg: VariantConfig,
  properties: Parameters<typeof runHierarchicalSim>[1],
  stats: Parameters<typeof runHierarchicalSim>[2],
  commuteById: Parameters<typeof runHierarchicalSim>[3],
  hiddenW: FeatureVector,
): RunRecord {
  const result = runHierarchicalSim(cfg, properties, stats, commuteById, COSINE_TARGET, hiddenW);
  return {
    variant: cfg.id,
    run: 0,
    cosineReachedRound: result.cosineReachedRound,
    totalRounds: result.totalRounds,
    cosineMaxValue: result.cosineMaxValue,
    cosineHistory: result.cosineHistory,
  };
}

// ──────────────────────────────────────────────────────────
// 통계 계산
// ──────────────────────────────────────────────────────────

function computeSummary(cfg: VariantConfig, records: RunRecord[]): VariantSummary {
  const reached = records.filter((r) => r.cosineReachedRound !== null);
  const reachedRounds = reached.map((r) => r.cosineReachedRound!).sort((a, b) => a - b);

  const std = (arr: number[]) => {
    if (arr.length < 2) return null;
    const m = arr.reduce((s, v) => s + v, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
  };

  // 달성 횟수 = 전체 run 평균. 미달성 run은 totalRounds(최대 회차)로 대체.
  const allRounds = records.map((r) => r.cosineReachedRound ?? r.totalRounds);
  const avgReachedRound = allRounds.reduce((s, v) => s + v, 0) / allRounds.length;

  return {
    variant: cfg.id,
    label: cfg.label,
    branch: cfg.branch,
    runs: records.length,
    reachedCount: reached.length,
    reachRate: reached.length / records.length,
    avgReachedRound,
    medianReachedRound: reachedRounds.length > 0 ? reachedRounds[Math.floor(reachedRounds.length / 2)] : null,
    minReachedRound: reachedRounds.length > 0 ? reachedRounds[0] : null,
    maxReachedRound: reachedRounds.length > 0 ? reachedRounds[reachedRounds.length - 1] : null,
    stdReachedRound: std(reachedRounds),
    avgMaxCosine: records.reduce((s, r) => s + r.cosineMaxValue, 0) / records.length,
    avgTotalRounds: records.reduce((s, r) => s + r.totalRounds, 0) / records.length,
  };
}

// ──────────────────────────────────────────────────────────
// CSV 출력
// ──────────────────────────────────────────────────────────

function summariesToCsv(summaries: VariantSummary[]): string {
  const headers = [
    "variant", "label", "branch", "runs", "reachedCount", "reachRate(%)",
    "avgReachedRound", "medianReachedRound", "minReachedRound", "maxReachedRound",
    "stdReachedRound", "avgMaxCosine", "avgTotalRounds",
  ];
  const rows = summaries.map((s) => [
    s.variant,
    `"${s.label}"`,
    s.branch,
    s.runs,
    s.reachedCount,
    (s.reachRate * 100).toFixed(1),
    s.avgReachedRound.toFixed(1),
    s.medianReachedRound ?? "N/A",
    s.minReachedRound ?? "N/A",
    s.maxReachedRound ?? "N/A",
    s.stdReachedRound?.toFixed(1) ?? "N/A",
    s.avgMaxCosine.toFixed(4),
    s.avgTotalRounds.toFixed(1),
  ]);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// ──────────────────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────────────────

async function main() {
  console.log("=== 모델 변형 비교 시뮬레이션 ===");
  console.log(`  변형 수: ${VARIANT_CONFIGS.length}`);
  console.log(`  반복 횟수/변형: ${RUNS}`);
  console.log(`  코사인 목표: ${COSINE_TARGET}`);
  console.log(`  최대 라운드: ${ABSOLUTE_MAX}`);
  if (BUILDING_ID) console.log(`  건물 ID: ${BUILDING_ID}`);
  console.log();

  console.log("Supabase에서 실제 매물/건물 불러오는 중...");
  const { properties, building, stats, commuteById } = await fetchRealData(BUILDING_ID);
  console.log(`  매물 ${properties.length}개, 건물: ${building.name}`);
  console.log();

  const allRecords: RunRecord[] = [];
  const t0 = Date.now();

  for (const cfg of VARIANT_CONFIGS) {
    console.log(`▶ ${cfg.id} (${cfg.label}) — ${RUNS}회 실행 중...`);
    const variantRecords: RunRecord[] = [];

    for (let i = 1; i <= RUNS; i++) {
      // 각 run마다 계층적 히든 가중치 생성 (모든 variant 공통)
      const hiddenW = sharedHiddenWeight();
      let record: RunRecord;
      try {
        if (!cfg.useHierarchical) {
          record = runOneFlat(cfg, properties, stats, commuteById, hiddenW);
        } else {
          record = runOneHier(cfg, properties, stats, commuteById, hiddenW);
        }
      } catch (e) {
        console.error(`  [${cfg.id}] run ${i} 실패:`, e);
        record = {
          variant: cfg.id,
          run: i,
          cosineReachedRound: null,
          totalRounds: ABSOLUTE_MAX,
          cosineMaxValue: 0,
          cosineHistory: [],
        };
      }
      record.run = i;
      variantRecords.push(record);
      allRecords.push(record);

      const tag = record.cosineReachedRound !== null
        ? `cos≥${COSINE_TARGET} @${record.cosineReachedRound}회`
        : `미도달 (max=${record.cosineMaxValue.toFixed(3)})`;
      process.stdout.write(`  [${String(i).padStart(2)}/${RUNS}] ${tag}\n`);
    }

    const summary = computeSummary(cfg, variantRecords);
    const rateStr = (summary.reachRate * 100).toFixed(1);
    const avgStr = summary.avgReachedRound.toFixed(1);
    console.log(
      `  → 성공률: ${rateStr}%  평균 달성 횟수(전체): ${avgStr}  최대 cos: ${summary.avgMaxCosine.toFixed(4)}`,
    );
    console.log();
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n총 실행 시간: ${elapsed}초`);

  // 변형별 요약 집계
  const summaries = VARIANT_CONFIGS.map((cfg) => {
    const records = allRecords.filter((r) => r.variant === cfg.id);
    return computeSummary(cfg, records);
  });

  // 결과 출력
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("변형별 요약 (코사인 ≥ " + COSINE_TARGET + " | 달성 횟수=전체 평균)");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(
    "ID   | 성공률  | 달성횟수(전체) | 최대cos"
  );
  console.log("─────┼─────────┼───────────────┼─────────");
  for (const s of summaries) {
    const rate = (s.reachRate * 100).toFixed(0).padStart(4) + "%";
    const avg = s.avgReachedRound.toFixed(1).padStart(10);
    const cos = s.avgMaxCosine.toFixed(4);
    console.log(
      `${s.variant.padEnd(4)} | ${rate}   | ${avg}    | ${cos}`,
    );
  }

  // 파일 저장
  const outDir = path.resolve(__dirname, "..", "out", "simulation");
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "variant-comparison.json");
  const csvPath = path.join(outDir, "variant-summary.csv");
  const svgPath = path.join(outDir, "variant-chart.svg");

  // raw data (cosineHistory는 크기가 크므로 생략 옵션)
  const compactRecords = allRecords.map(({ cosineHistory: _, ...r }) => r);
  fs.writeFileSync(jsonPath, JSON.stringify({ summaries, records: compactRecords }, null, 2), "utf-8");
  console.log(`\n  JSON → ${jsonPath}`);

  fs.writeFileSync(csvPath, summariesToCsv(summaries), "utf-8");
  console.log(`  CSV  → ${csvPath}`);

  // 대표 수렴 곡선 저장 (4개 variant: F1, F4, H4, A4)
  const convergenceSeries: Record<string, number[][]> = {};
  for (const variantId of ["F1", "F4", "H4", "A4"]) {
    const records = allRecords.filter((r) => r.variant === variantId);
    // 각 run의 코사인 히스토리를 다시 가져오기 위해 원본 allRecords를 사용
    // (compact 버전에는 없으므로 원본 사용)
    convergenceSeries[variantId] = records
      .filter((_, i) => i < 5) // 최대 5개 run만 (SVG 크기 제한)
      .map((r) => r.cosineHistory);
  }

  const svgContent = renderVariantChart(summaries, convergenceSeries);
  fs.writeFileSync(svgPath, svgContent, "utf-8");
  console.log(`  SVG  → ${svgPath}`);

  console.log("\n완료!");
}

main().catch((e) => {
  console.error("시뮬레이션 실패:", e);
  process.exit(1);
});
