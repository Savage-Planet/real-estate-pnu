/**
 * navigator-v2.ts
 * ================
 * 계층적 선호 학습 v2 전체 오케스트레이터
 *
 * Flow:
 *   [Level 1] 가상 아이템 비교 (AMPLe + Sadigh) → 4D 카테고리 가중치 수렴
 *        ↓ argmax w_macro → 최우선 카테고리 결정
 *   [Level 2] 카테고리 내 MCMC (실제 매물 + 가상 서브 아이템)
 *        ↓ Top-1 score < escape_threshold → 2위 카테고리로 이탈 (최대 2회)
 *   [완료] ConvergenceReportV2 반환
 */

import type { Property } from "@/types";
import type { FeatureVector, FeatureStats, CommuteFeatures } from "@/lib/feature-engineer";
import { cosineSimilarity } from "@/lib/reward-model";
import type { CategoryVector, GroupKey } from "./feature-groups";
import {
  toCategoryVector,
  weightToCategoryVector,
  CATEGORY_NAMES,
  GROUP_KEYS,
} from "./feature-groups";
import type { MacroPosterior } from "./macro-learner";
import {
  createMacroPosterior,
  updateMacroPosterior,
  getMacroMeanWeight,
  isMacroConverged,
  macroPosteriorConcentration,
  topCategoryIdx,
  secondCategoryIdx,
} from "./macro-learner";
import { generateCategoryArchetypes, selectMostInfoPair } from "./virtual-generator";
import type { MicroResult } from "./micro-learner";
import { runMicro } from "./micro-learner";

// ──────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────

export interface NavigatorV2Config {
  verbose?: boolean;
  topK?: number;
  maxMacroComparisons?: number;
  escapeThreshold?: number;
  maxEscapes?: number;
  totalMaxComparisons?: number;
}

export interface ConvergenceReportV2 {
  success: boolean;
  finalGroupKey: GroupKey;
  finalGroupLabel: string;
  macroWeights: CategoryVector;
  topRecommendations: Array<{ propertyId: string; score: number }>;
  level1Comparisons: number;
  level2Comparisons: number;
  totalComparisons: number;
  escapeCount: number;
  cosineToHiddenSub: number | null;
  macroConcentration: number;
  microConcentration: number;
  forceTerminated: boolean;
  convergedAt: string;
}

export interface NavigatorV2RunResult {
  report: ConvergenceReportV2;
  macroPosterior: MacroPosterior;
  microResults: MicroResult[];
}

// ──────────────────────────────────────────────────────────
// 시뮬레이션용: hidden weight로 가상 아이템 비교 결정
// ──────────────────────────────────────────────────────────

function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

function log(verbose: boolean, msg: string) {
  if (verbose) process.stdout.write(msg + "\n");
}

// ──────────────────────────────────────────────────────────
// 메인 실행 함수
// ──────────────────────────────────────────────────────────

export function runNavigatorV2(
  properties: Property[],
  stats: FeatureStats,
  commuteById: Map<string, CommuteFeatures>,
  hiddenWeight: FeatureVector,
  config: NavigatorV2Config = {},
): NavigatorV2RunResult {
  const {
    verbose = false,
    topK = 3,
    maxMacroComparisons = 10,
    escapeThreshold = 0.3,
    maxEscapes = 2,
    totalMaxComparisons = 35,
  } = config;

  // ── Level 1: 카테고리 가중치 학습 ──────────────────────
  log(verbose, `[Level 1 시작] 카테고리 ${GROUP_KEYS.length}개 가중치 탐색 시작 (가상 아이템 비교)`);

  let macroPosterior = createMacroPosterior();
  const virtualPool = generateCategoryArchetypes();

  // hidden weight → 카테고리 선호도 벡터 (invert 부호 반전 적용)
  const hiddenCatVec = weightToCategoryVector(hiddenWeight);

  let level1Comparisons = 0;

  while (!isMacroConverged(macroPosterior, maxMacroComparisons)) {
    const [vA, vB] = selectMostInfoPair(virtualPool, macroPosterior);
    const pairKey = `${vA.id}__${vB.id}`;
    macroPosterior.usedPairKeys.add(pairKey);

    // 시뮬레이션: hidden category weight로 winner 결정
    const scoreA = dot(hiddenCatVec, vA.categoryVector);
    const scoreB = dot(hiddenCatVec, vB.categoryVector);
    const [winner, loser] = scoreA >= scoreB ? [vA, vB] : [vB, vA];

    macroPosterior = updateMacroPosterior(macroPosterior, winner.categoryVector, loser.categoryVector);
    level1Comparisons++;

    const mean = getMacroMeanWeight(macroPosterior);
    log(
      verbose,
      `[Level 1] 비교 ${level1Comparisons}: "${vA.label}" vs "${vB.label}" → "${winner.label}" 선택 | w=[${mean.map((v) => v.toFixed(3)).join(", ")}]`,
    );
  }

  const macroWeights = getMacroMeanWeight(macroPosterior);
  const top1CatIdx = topCategoryIdx(macroPosterior);
  const top2CatIdx = secondCategoryIdx(macroPosterior);

  log(
    verbose,
    `[Level 1 완료] 최우선 카테고리: "${CATEGORY_NAMES[top1CatIdx]}" (w=${macroWeights[top1CatIdx].toFixed(3)}), 비교 횟수: ${level1Comparisons}`,
  );

  // ── Level 2: 카테고리 내 탐색 ──────────────────────────
  const microResults: MicroResult[] = [];
  let escapeCount = 0;
  let currentCatIdx = top1CatIdx;
  let level2Comparisons = 0;
  let totalComparisons = level1Comparisons;
  let forceTerminated = false;

  while (escapeCount <= maxEscapes) {
    const currentGroupKey = GROUP_KEYS[currentCatIdx];
    const currentGroupLabel = CATEGORY_NAMES[currentCatIdx];

    // 현재 카테고리 멤버: 모든 매물 (클러스터 없이 전체 매물에서 탐색)
    const microResult = runMicro(
      currentGroupKey,
      properties,
      stats,
      commuteById,
      hiddenWeight,
      { verbose, topK },
    );
    microResults.push(microResult);
    level2Comparisons += microResult.comparisons;
    totalComparisons += microResult.comparisons;

    log(
      verbose,
      `[Level 2 완료] 카테고리: "${currentGroupLabel}", 비교 횟수: ${microResult.comparisons}, 수렴: ${microResult.converged}, 코사인: ${microResult.cosineToHiddenSub?.toFixed(4) ?? "N/A"}`,
    );

    if (totalComparisons >= totalMaxComparisons) {
      forceTerminated = true;
      log(verbose, `[경고] 총 비교 횟수 ${totalMaxComparisons}회 초과 → 강제 종료`);
      break;
    }

    if (microResult.converged) break;

    // 이탈 판단
    const top1Score = microResult.topProperties[0]?.score ?? 0;
    if (escapeCount < maxEscapes && top1Score < escapeThreshold) {
      const nextCatIdx = escapeCount === 0 ? top2CatIdx : (currentCatIdx + 1) % GROUP_KEYS.length;
      currentCatIdx = nextCatIdx;
      escapeCount++;
      log(
        verbose,
        `[이탈] Top-1 score=${top1Score.toFixed(3)} < ${escapeThreshold} → "${CATEGORY_NAMES[nextCatIdx]}"으로 전환 (이탈 ${escapeCount}회)`,
      );
    } else {
      break;
    }
  }

  const lastMicro = microResults[microResults.length - 1];
  const finalGroupKey = GROUP_KEYS[currentCatIdx];

  log(
    verbose,
    `[전체 완료] 총 비교 횟수: ${totalComparisons}, 이탈 횟수: ${escapeCount}`,
  );

  const report: ConvergenceReportV2 = {
    success: lastMicro?.converged ?? false,
    finalGroupKey,
    finalGroupLabel: CATEGORY_NAMES[currentCatIdx],
    macroWeights,
    topRecommendations: lastMicro?.topProperties ?? [],
    level1Comparisons,
    level2Comparisons,
    totalComparisons,
    escapeCount,
    cosineToHiddenSub: lastMicro?.cosineToHiddenSub ?? null,
    macroConcentration: macroPosteriorConcentration(macroPosterior),
    microConcentration: lastMicro
      ? (lastMicro.converged ? 1 : 0.8)
      : 0,
    forceTerminated,
    convergedAt: new Date().toISOString(),
  };

  return { report, macroPosterior, microResults };
}
