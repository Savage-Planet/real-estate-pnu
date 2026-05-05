/**
 * run-hierarchical-v2-batch.ts
 * ==============================
 * 계층적 추천 모델 v2 배치 실험:
 *   BWM 초기화 유/무에 따른 수렴 비교
 *   "코사인 유사도 0.9 첫 도달까지 필요한 최소 비교 횟수" 통계
 *
 * 실행:
 *   npm run sim:hierarchical-v2-batch
 *   npm run sim:hierarchical-v2-batch -- --runs 50 --target 0.9 --max 60
 *
 * 출력:
 *   - BWM 없음 vs BWM 있음 비교 테이블 (코사인 달성 비교 횟수, 성공률)
 *   - out/simulation/hierarchical/v2-batch-result.json
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import type { FeatureVector } from "@/lib/feature-engineer";
import { normalizeToUnitBall } from "@/lib/reward-model";
import { fetchRealData } from "@/lib/simulation/fetch-real-data";
import {
  createMacroPosterior,
  updateMacroPosterior,
  isMacroConverged,
  topCategoryIdx,
} from "@/lib/hierarchical/v2/macro-learner";
import { generateCategoryArchetypes, selectMostInfoPair } from "@/lib/hierarchical/v2/virtual-generator";
import { runMicro } from "@/lib/hierarchical/v2/micro-learner";
import { weightToCategoryVector, GROUP_KEYS, CATEGORY_NAMES } from "@/lib/hierarchical/v2/feature-groups";
import type { Property } from "@/types";
import type { FeatureStats, CommuteFeatures } from "@/lib/feature-engineer";

// ──────────────────────────────────────────────────────────
// CLI 인수
// ──────────────────────────────────────────────────────────

function getArgNum(name: string, defaultVal: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? parseFloat(process.argv[idx + 1]) || defaultVal : defaultVal;
}

const RUNS = getArgNum("runs", 30);
const COSINE_TARGET = getArgNum("target", 0.9);
const MAX_MICRO_COMPARISONS = getArgNum("max", 80);  // 6D 안전 카테고리 수렴 여유
const MAX_MACRO_COMPARISONS = getArgNum("macro", 10);

// ──────────────────────────────────────────────────────────
// 출력 경로
// ──────────────────────────────────────────────────────────

const OUT_DIR = path.join(process.cwd(), "out", "simulation", "hierarchical");
fs.mkdirSync(OUT_DIR, { recursive: true });
const BATCH_FILE = path.join(OUT_DIR, "v2-batch-result.json");

// ──────────────────────────────────────────────────────────
// 페르소나 정의
// ──────────────────────────────────────────────────────────

interface Persona {
  name: string;
  hidden: FeatureVector;
  expectedCatIdx: number;
}

const PERSONAS: Persona[] = [
  {
    name: "A (가격 우선)",
    hidden: normalizeToUnitBall([
      -0.9, -0.7, -0.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ] as FeatureVector),
    expectedCatIdx: 1,
  },
  {
    name: "B (거리 우선)",
    hidden: normalizeToUnitBall([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9, 0.6,
      0, 0, 0, 0, 0.5,
    ] as FeatureVector),
    expectedCatIdx: 0,
  },
  {
    name: "C (안전 우선)",
    hidden: normalizeToUnitBall([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.9, 0, 0,
      0.7, 0.7, 0, 0, 0,
    ] as FeatureVector),
    expectedCatIdx: 2,
  },
];

// ──────────────────────────────────────────────────────────
// 단일 실행
// ──────────────────────────────────────────────────────────

interface SingleRunResult {
  selectedCatIdx: number;
  correctCategory: boolean;
  l1Comparisons: number;
  l2Comparisons: number;
  totalComparisons: number;
  cosineReachedTotal: number | null;
  finalCosine: number | null;
}

function runOnce(
  persona: Persona,
  properties: Property[],
  stats: FeatureStats,
  commuteById: Map<string, CommuteFeatures>,
  useBwm: boolean,
): SingleRunResult {
  // ── Level 1 (Macro) ───────────────────────────────
  let macroPosterior = createMacroPosterior();
  const virtualPool = generateCategoryArchetypes();
  const hiddenCatVec = weightToCategoryVector(persona.hidden);
  let l1Comparisons = 0;

  function dotCat(a: number[], b: number[]): number {
    return a.reduce((s, v, i) => s + v * b[i], 0);
  }

  while (!isMacroConverged(macroPosterior, MAX_MACRO_COMPARISONS)) {
    const [vA, vB] = selectMostInfoPair(virtualPool, macroPosterior);
    macroPosterior.usedPairKeys.add(`${vA.id}__${vB.id}`);

    const scoreA = dotCat(hiddenCatVec, vA.categoryVector);
    const scoreB = dotCat(hiddenCatVec, vB.categoryVector);
    const [winner, loser] = scoreA >= scoreB ? [vA, vB] : [vB, vA];

    macroPosterior = updateMacroPosterior(macroPosterior, winner.categoryVector, loser.categoryVector);
    l1Comparisons++;
  }

  const selectedCatIdx = topCategoryIdx(macroPosterior);

  // ── Level 2 (Micro) ───────────────────────────────
  const microResult = runMicro(
    GROUP_KEYS[selectedCatIdx],
    properties,
    stats,
    commuteById,
    persona.hidden,
    {
      verbose: false,
      topK: 3,
      maxComparisonsOverride: MAX_MICRO_COMPARISONS,
      cosineTarget: COSINE_TARGET,
      useBwmInit: useBwm,
    },
  );

  const totalComparisons = l1Comparisons + microResult.comparisons;
  const cosineReachedTotal =
    microResult.cosineReachedRound !== null
      ? l1Comparisons + microResult.cosineReachedRound
      : null;

  return {
    selectedCatIdx,
    correctCategory: selectedCatIdx === persona.expectedCatIdx,
    l1Comparisons,
    l2Comparisons: microResult.comparisons,
    totalComparisons,
    cosineReachedTotal,
    finalCosine: microResult.cosineToHiddenSub,
  };
}

// ──────────────────────────────────────────────────────────
// 통계
// ──────────────────────────────────────────────────────────

interface StatSummary {
  mean: number; min: number; max: number;
  p25: number; median: number; p75: number;
}

function calcStats(values: number[]): StatSummary {
  if (values.length === 0) return { mean: NaN, min: NaN, max: NaN, p25: NaN, median: NaN, p75: NaN };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const pct = (p: number) => sorted[Math.min(Math.floor(n * p), n - 1)];
  return {
    mean: values.reduce((s, v) => s + v, 0) / n,
    min: sorted[0],
    max: sorted[n - 1],
    p25: pct(0.25),
    median: pct(0.5),
    p75: pct(0.75),
  };
}

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(v)) return "-";
  return v.toFixed(decimals);
}

// ──────────────────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("═".repeat(70) + "\n");
  process.stdout.write("  v2 배치 실험: BWM 초기화 유/무 비교\n");
  process.stdout.write(`  실행 횟수: ${RUNS}회 | 코사인 목표: ≥${COSINE_TARGET} | L2 최대: ${MAX_MICRO_COMPARISONS}회\n`);
  process.stdout.write("═".repeat(70) + "\n\n");

  process.stdout.write("데이터 로딩 중 (Supabase)...\n");
  const { properties, stats: featureStats, commuteById } = await fetchRealData();
  process.stdout.write(`  → 매물 ${properties.length}개 로드 완료\n\n`);

  const allResults: object[] = [];

  for (const persona of PERSONAS) {
    process.stdout.write(`${"─".repeat(70)}\n`);
    process.stdout.write(`  페르소나: ${persona.name}  (예상: ${CATEGORY_NAMES[persona.expectedCatIdx]})\n`);
    process.stdout.write(`${"─".repeat(70)}\n`);

    const resultsByMode: Record<"without" | "with", SingleRunResult[]> = { without: [], with: [] };

    // BWM 없음 실험
    process.stdout.write("  [1/2] BWM 없음 실행 중...\n");
    let done = 0;
    for (let i = 0; i < RUNS; i++) {
      resultsByMode.without.push(runOnce(persona, properties, featureStats, commuteById, false));
      done++;
      if (done % 10 === 0) process.stdout.write(`    ${done}/${RUNS}\n`);
    }

    // BWM 있음 실험
    process.stdout.write("  [2/2] BWM 있음 실행 중...\n");
    done = 0;
    for (let i = 0; i < RUNS; i++) {
      resultsByMode.with.push(runOnce(persona, properties, featureStats, commuteById, true));
      done++;
      if (done % 10 === 0) process.stdout.write(`    ${done}/${RUNS}\n`);
    }

    // 통계 집계
    const modeEntries = (["without", "with"] as const).map((mode) => {
      const runs = resultsByMode[mode];
      const successRuns = runs.filter((r) => r.cosineReachedTotal !== null);
      const correctCat = runs.filter((r) => r.correctCategory).length;

      const reachedStats = calcStats(successRuns.map((r) => r.cosineReachedTotal!));
      const cosineStats = calcStats(runs.map((r) => r.finalCosine ?? 0));
      const l2Stats = calcStats(runs.map((r) => r.l2Comparisons));

      return {
        mode,
        label: mode === "without" ? "BWM 없음" : "BWM 있음 (Rezaei 2015)",
        catAccuracyPct: (correctCat / RUNS) * 100,
        successCount: successRuns.length,
        successRatePct: (successRuns.length / RUNS) * 100,
        reachedStats,
        cosineStats,
        l2Stats,
      };
    });

    // 출력
    process.stdout.write("\n");
    const hdr = "  모드".padEnd(26) + "카테고리".padEnd(10) + "성공률".padEnd(8)
      + "평균도달".padEnd(9) + "중앙값".padEnd(8) + "최소".padEnd(6) + "최대".padEnd(6)
      + "L2평균".padEnd(8) + "코사인평균\n";
    process.stdout.write(hdr);
    process.stdout.write("  " + "─".repeat(78) + "\n");

    for (const e of modeEntries) {
      const r = e.reachedStats;
      process.stdout.write(
        `  ${e.label.padEnd(24)}`
        + `${fmt(e.catAccuracyPct, 0)}%`.padEnd(10)
        + `${fmt(e.successRatePct, 0)}%`.padEnd(8)
        + fmt(r.mean).padEnd(9)
        + fmt(r.median, 0).padEnd(8)
        + fmt(r.min, 0).padEnd(6)
        + fmt(r.max, 0).padEnd(6)
        + fmt(e.l2Stats.mean).padEnd(8)
        + fmt(e.cosineStats.mean, 4) + "\n",
      );
    }

    // BWM 개선 비율
    const wOut = modeEntries[0];
    const wIn = modeEntries[1];
    if (!isNaN(wOut.reachedStats.mean) && !isNaN(wIn.reachedStats.mean)) {
      const improvement = ((wOut.reachedStats.mean - wIn.reachedStats.mean) / wOut.reachedStats.mean) * 100;
      const sign = improvement >= 0 ? "↓" : "↑";
      process.stdout.write(
        `\n  BWM 도입 효과: 평균 도달 횟수 ${sign}${Math.abs(improvement).toFixed(1)}%`
        + ` (${fmt(wOut.reachedStats.mean)}회 → ${fmt(wIn.reachedStats.mean)}회)\n`,
      );
    }
    process.stdout.write("\n");

    allResults.push({
      persona: persona.name,
      expectedCatLabel: CATEGORY_NAMES[persona.expectedCatIdx],
      runs: RUNS,
      without: modeEntries[0],
      with: modeEntries[1],
    });
  }

  // 전체 요약
  process.stdout.write("═".repeat(70) + "\n");
  process.stdout.write("  전체 요약 (BWM 없음 vs BWM 있음)\n");
  process.stdout.write("═".repeat(70) + "\n");
  process.stdout.write(
    "  페르소나".padEnd(18) + "성공률(없음)".padEnd(14) + "성공률(있음)".padEnd(14)
    + "도달(없음)".padEnd(12) + "도달(있음)".padEnd(12) + "개선율\n",
  );
  process.stdout.write("  " + "─".repeat(72) + "\n");

  for (const r of allResults as any[]) {
    const wo = r.without;
    const wi = r.with;
    const imp = !isNaN(wo.reachedStats.mean) && !isNaN(wi.reachedStats.mean)
      ? ((wo.reachedStats.mean - wi.reachedStats.mean) / wo.reachedStats.mean * 100).toFixed(1) + "%"
      : "-";
    process.stdout.write(
      `  ${r.persona.padEnd(16)}`
      + `${fmt(wo.successRatePct, 0)}%`.padEnd(14)
      + `${fmt(wi.successRatePct, 0)}%`.padEnd(14)
      + fmt(wo.reachedStats.mean).padEnd(12)
      + fmt(wi.reachedStats.mean).padEnd(12)
      + imp + "\n",
    );
  }

  fs.writeFileSync(BATCH_FILE, JSON.stringify({
    runAt: new Date().toISOString(),
    config: {
      runs: RUNS,
      cosineTarget: COSINE_TARGET,
      maxMicroComparisons: MAX_MICRO_COMPARISONS,
      maxMacroComparisons: MAX_MACRO_COMPARISONS,
    },
    propertyCount: properties.length,
    personas: allResults,
  }, null, 2));

  process.stdout.write(`\n결과 저장: ${BATCH_FILE}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
