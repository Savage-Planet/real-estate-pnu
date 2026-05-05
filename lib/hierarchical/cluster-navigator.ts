/**
 * cluster-navigator.ts
 * ====================
 * Phase 1: Bradley-Terry 모델로 군집 선호도 탐색
 * Phase 2: MCMC(기존 reward-model) + EVR(기존 query-selector)로 군집 내 탐색
 * Phase 3: 이탈 판단 및 fallback 군집 전환
 *
 * 참고:
 *   Bradley & Terry (1952) Biometrika 39(3) - Bradley-Terry Model
 *   Chu & Ghahramani (2005) ICML            - EVR 기반 쌍 선택
 *   Tatli, Chen & Vinayak (2024) ICML       - 계층적 수렴 보장
 */

import type { Property } from "@/types";
import type { FeatureVector, FeatureStats, CommuteFeatures } from "../feature-engineer";
import { toFeatureVector, FEATURE_DIM } from "../feature-engineer";
import {
  createModel,
  updateModel,
  getMeanWeight,
  scoreProperty,
  normalizeToUnitBall,
  cosineSimilarity,
  type RewardModel,
} from "../reward-model";
import { selectPair } from "../query-selector";
import { checkConvergence, createConvergenceState } from "../convergence";
import type { ClusterBuildOutput, ClusterResult } from "./cluster-builder";

// ──────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────

export interface NavigationSession {
  sessionId: string;
  phase: "cluster" | "within" | "escaped";
  currentClusterId: number;
  fallbackClusterId: number;
  clusterScores: number[];
  totalComparisons: number;
  escapeCount: number;
  startTimestamp: string;
}

export interface Phase1Result {
  winnerClusterId: number;
  fallbackClusterId: number;
  finalScores: number[];
  comparisons: number;
  converged: boolean;
}

export interface Phase2Result {
  topProperties: Array<{ propertyId: string; score: number }>;
  comparisons: number;
  converged: boolean;
  finalModel: RewardModel;
  cosineToHidden: number | null;
}

export interface NavigationConfig {
  /** Phase 3 이탈 임계값: Top-1 score < this → escape (default 0.6) */
  escapeThreshold?: number;
  /** Phase 1 Bradley-Terry 수렴 비율 (default 2.0) */
  btConvergeRatio?: number;
  /** Phase 1 최대 비교 횟수 = ceil(log2(K))*2+2 */
  phase1MaxComparisons?: number;
  /** Phase 2 최대 비교 횟수 = 2*ceil(log2(clusterSize))+4 */
  phase2MaxFactor?: number;
  /** 최대 이탈 횟수 (default 2) */
  maxEscapes?: number;
  /** verbose 출력 여부 */
  verbose?: boolean;
  /** Top-K 개수 (default 3) */
  topK?: number;
}

// ──────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────

function dot(a: FeatureVector, b: FeatureVector): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function log(verbose: boolean, msg: string) {
  if (verbose) process.stdout.write(msg + "\n");
}

// ──────────────────────────────────────────────────────────
// centroid 기반 prior mean 주입 모델 생성
// (기존 createModel은 건드리지 않음)
// ──────────────────────────────────────────────────────────

function createModelFromCentroid(centroid: FeatureVector): RewardModel {
  const priorMean = normalizeToUnitBall([...centroid]);
  // 기존 createModel에 initialWeights 없이 호출한 뒤 priorMean만 교체
  const base = createModel(FEATURE_DIM);
  return { ...base, priorMean };
}

// ──────────────────────────────────────────────────────────
// Phase 1: Bradley-Terry 군집 탐색
// ──────────────────────────────────────────────────────────

/**
 * 시뮬레이션용: 대표 매물 특징 벡터와 hidden weight 내적으로 승자 결정
 */
export function runPhase1(
  clusterOutput: ClusterBuildOutput,
  propertyMap: Map<string, Property>,
  stats: FeatureStats,
  commuteById: Map<string, CommuteFeatures>,
  hiddenWeight: FeatureVector,
  config: NavigationConfig = {},
): Phase1Result {
  const {
    btConvergeRatio = 2.0,
    verbose = false,
  } = config;

  const { clusters, k } = clusterOutput;
  const maxComparisons = Math.ceil(Math.log2(Math.max(k, 2))) * 2 + 2;

  log(verbose, `[Phase 1 시작] 군집 ${k}개 탐색 시작`);

  // Bradley-Terry score 초기화
  const scores: number[] = new Array(k).fill(1.0);
  const usedPairs = new Set<string>();
  let comparisons = 0;

  while (comparisons < maxComparisons) {
    // 인접 순위 쌍 중 score 차이 최소 쌍 선택
    const ranked = scores
      .map((s, id) => ({ id, s }))
      .sort((a, b) => b.s - a.s);

    let bestPair: [number, number] | null = null;
    let minDiff = Infinity;

    for (let i = 0; i < ranked.length - 1; i++) {
      const a = ranked[i].id;
      const b = ranked[i + 1].id;
      const pairKey = `${Math.min(a, b)}-${Math.max(a, b)}`;
      if (usedPairs.has(pairKey)) continue;
      const diff = Math.abs(scores[a] - scores[b]);
      if (diff < minDiff) { minDiff = diff; bestPair = [a, b]; }
    }

    if (!bestPair) break; // 모든 쌍 소진

    const [cA, cB] = bestPair;
    usedPairs.add(`${Math.min(cA, cB)}-${Math.max(cA, cB)}`);

    // 대표 매물로 승자 결정
    const repA = propertyMap.get(clusters[cA].representativePropertyId);
    const repB = propertyMap.get(clusters[cB].representativePropertyId);
    if (!repA || !repB) { comparisons++; continue; }

    const fvA = toFeatureVector(repA, stats, commuteById.get(repA.id));
    const fvB = toFeatureVector(repB, stats, commuteById.get(repB.id));
    const scoreA = dot(hiddenWeight, fvA);
    const scoreB = dot(hiddenWeight, fvB);
    const winnerId = scoreA >= scoreB ? cA : cB;
    const loserId = scoreA >= scoreB ? cB : cA;

    // Bradley-Terry 업데이트
    const total = scores[winnerId] + scores[loserId];
    scores[winnerId] += scores[loserId] / total;
    scores[loserId] -= scores[loserId] / total;
    comparisons++;

    log(verbose, `[Phase 1] 비교 ${comparisons}: 군집 "${clusters[cA].label}" vs 군집 "${clusters[cB].label}" → ${clusters[winnerId].label} 선택`);
    log(verbose, `[Phase 1] score 업데이트: [${scores.map((s) => s.toFixed(3)).join(", ")}]`);

    // 수렴 체크
    const sortedScores = [...scores].sort((a, b) => b - a);
    if (sortedScores[0] / (sortedScores[1] || 1) >= btConvergeRatio) break;
  }

  // 순위 결정
  const sortedIds = scores.map((s, id) => ({ id, s })).sort((a, b) => b.s - a.s);
  const winnerClusterId = sortedIds[0].id;
  const fallbackClusterId = sortedIds[1]?.id ?? 0;
  const converged = (scores[winnerClusterId] / (scores[fallbackClusterId] || 1)) >= btConvergeRatio;

  log(verbose, `[Phase 1 완료] 선호 군집: "${clusters[winnerClusterId].label}" (score: ${scores[winnerClusterId].toFixed(3)}), 비교 횟수: ${comparisons}`);

  return { winnerClusterId, fallbackClusterId, finalScores: scores, comparisons, converged };
}

// ──────────────────────────────────────────────────────────
// Phase 2: MCMC 군집 내 탐색
// ──────────────────────────────────────────────────────────

export function runPhase2(
  cluster: ClusterResult,
  propertyMap: Map<string, Property>,
  stats: FeatureStats,
  commuteById: Map<string, CommuteFeatures>,
  hiddenWeight: FeatureVector,
  phase1Scores: number[],
  config: NavigationConfig = {},
): Phase2Result {
  const {
    verbose = false,
    topK = 3,
    phase2MaxFactor = 1,
  } = config;

  const members = cluster.memberIds
    .map((id) => propertyMap.get(id))
    .filter((p): p is Property => p != null);

  const clusterSize = members.length;
  const maxComparisons = 2 * Math.ceil(Math.log2(Math.max(clusterSize, 2))) + 4;

  log(verbose, `[Phase 2 시작] 군집 내 매물 ${clusterSize}개 탐색 시작`);

  // Phase 1 centroid 기반으로 prior 초기화
  let model = createModelFromCentroid(cluster.centroid);

  const usedPairs = new Set<string>();
  let convergenceState = createConvergenceState();
  const minRounds = 3;
  let comparisons = 0;

  while (comparisons < maxComparisons * phase2MaxFactor) {
    const pair = selectPair(model, members, stats, usedPairs, commuteById);
    const pairKey = [pair.a.id, pair.b.id].sort().join("-");
    usedPairs.add(pairKey);

    const fvA = toFeatureVector(pair.a, stats, commuteById.get(pair.a.id));
    const fvB = toFeatureVector(pair.b, stats, commuteById.get(pair.b.id));
    const scoreA = dot(hiddenWeight, fvA);
    const scoreB = dot(hiddenWeight, fvB);
    const winner = scoreA >= scoreB ? pair.a : pair.b;
    const loser = scoreA >= scoreB ? pair.b : pair.a;

    model = updateModel(
      model,
      toFeatureVector(winner, stats, commuteById.get(winner.id)),
      toFeatureVector(loser, stats, commuteById.get(loser.id)),
    );
    comparisons++;

    log(verbose, `[Phase 2] 비교 ${comparisons}: 매물 ${pair.a.id.slice(0, 8)} vs 매물 ${pair.b.id.slice(0, 8)} → ${winner.id.slice(0, 8)} 선택`);

    convergenceState = checkConvergence(
      convergenceState,
      model,
      members,
      stats,
      comparisons,
      minRounds,
      maxComparisons * phase2MaxFactor,
      commuteById,
    );

    if (convergenceState.converged) break;
  }

  // Top-K 결과
  const scored = members.map((p) => ({
    propertyId: p.id,
    score: scoreProperty(model, toFeatureVector(p, stats, commuteById.get(p.id))),
  }));
  scored.sort((a, b) => b.score - a.score);
  const topProperties = scored.slice(0, topK);

  // 코사인 유사도 (hidden weight 대비 학습된 가중치)
  const meanW = getMeanWeight(model);
  const cosine = cosineSimilarity(meanW, hiddenWeight);

  log(verbose, `[Phase 2 완료] Top-1: 매물 ${topProperties[0]?.propertyId.slice(0, 8)}, 비교 횟수: ${comparisons}`);

  return {
    topProperties,
    comparisons,
    converged: convergenceState.converged,
    finalModel: model,
    cosineToHidden: cosine,
  };
}

// ──────────────────────────────────────────────────────────
// Phase 3: 이탈 판단
// ──────────────────────────────────────────────────────────

export function shouldEscape(
  phase2Result: Phase2Result,
  maxComparisons: number,
  comparisons: number,
  config: NavigationConfig = {},
): boolean {
  const { escapeThreshold = 0.6 } = config;
  const top1Score = phase2Result.topProperties[0]?.score ?? 0;
  if (top1Score < escapeThreshold) return true;
  if (!phase2Result.converged && comparisons >= maxComparisons) return true;
  return false;
}
