/**
 * hierarchical-convergence.ts
 * ============================
 * Phase별 수렴 상태 통합 추적 + 전체 세션 종료 조건 판단 + 수렴 리포트 생성
 */

import type { Property } from "@/types";
import type { FeatureVector, FeatureStats, CommuteFeatures } from "../feature-engineer";
import { toFeatureVector } from "../feature-engineer";
import { scoreProperty, cosineSimilarity, getMeanWeight } from "../reward-model";
import type { ClusterBuildOutput } from "./cluster-builder";
import type { NavigationSession, Phase1Result, Phase2Result } from "./cluster-navigator";
import {
  runPhase1,
  runPhase2,
  shouldEscape,
  type NavigationConfig,
} from "./cluster-navigator";

// ──────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────

export interface ConvergenceReport {
  success: boolean;
  finalClusterId: number;
  finalClusterLabel: string;
  topRecommendations: Array<{ propertyId: string; score: number }>;
  phase1Comparisons: number;
  phase2Comparisons: number;
  totalComparisons: number;
  escapeCount: number;
  cosineToHidden: number | null;
  convergedAt: string;
  forceTerminated: boolean;
}

export interface HierarchicalRunResult {
  session: NavigationSession;
  phase1: Phase1Result;
  phase2Series: Phase2Result[];  // 이탈 포함 여러 번의 Phase 2
  report: ConvergenceReport;
}

// ──────────────────────────────────────────────────────────
// 전체 계층적 탐색 실행 (시뮬레이션용)
// ──────────────────────────────────────────────────────────

export function runHierarchical(
  clusterOutput: ClusterBuildOutput,
  propertyMap: Map<string, Property>,
  stats: FeatureStats,
  commuteById: Map<string, CommuteFeatures>,
  hiddenWeight: FeatureVector,
  config: NavigationConfig = {},
): HierarchicalRunResult {
  const {
    maxEscapes = 2,
    verbose = false,
  } = config;

  const TOTAL_MAX_COMPARISONS = 30;

  const sessionId = `session-${Date.now()}`;
  let session: NavigationSession = {
    sessionId,
    phase: "cluster",
    currentClusterId: 0,
    fallbackClusterId: 0,
    clusterScores: new Array(clusterOutput.k).fill(1.0),
    totalComparisons: 0,
    escapeCount: 0,
    startTimestamp: new Date().toISOString(),
  };

  // ── Phase 1 ──────────────────────────────────────────
  const phase1 = runPhase1(
    clusterOutput, propertyMap, stats, commuteById, hiddenWeight, config,
  );

  session = {
    ...session,
    phase: "within",
    currentClusterId: phase1.winnerClusterId,
    fallbackClusterId: phase1.fallbackClusterId,
    clusterScores: phase1.finalScores,
    totalComparisons: phase1.comparisons,
  };

  // ── Phase 2 (이탈 포함 반복) ─────────────────────────
  const phase2Series: Phase2Result[] = [];
  let forceTerminated = false;

  while (session.escapeCount <= maxEscapes) {
    const cluster = clusterOutput.clusters[session.currentClusterId];
    const clusterSize = cluster.memberIds.length;
    const phase2MaxComparisons = 2 * Math.ceil(Math.log2(Math.max(clusterSize, 2))) + 4;

    const phase2 = runPhase2(
      cluster, propertyMap, stats, commuteById, hiddenWeight,
      session.clusterScores, config,
    );
    phase2Series.push(phase2);

    session = {
      ...session,
      totalComparisons: session.totalComparisons + phase2.comparisons,
    };

    // 전체 강제 종료 체크
    if (session.totalComparisons >= TOTAL_MAX_COMPARISONS) {
      forceTerminated = true;
      if (verbose) process.stdout.write(`[경고] 총 비교 횟수 ${TOTAL_MAX_COMPARISONS}회 초과 → 강제 종료\n`);
      break;
    }

    // 수렴 성공
    if (phase2.converged) break;

    // 이탈 판단
    if (
      session.escapeCount < maxEscapes &&
      shouldEscape(phase2, phase2MaxComparisons, phase2.comparisons, config)
    ) {
      session = {
        ...session,
        phase: "escaped",
        currentClusterId: session.fallbackClusterId,
        escapeCount: session.escapeCount + 1,
      };
      if (verbose) {
        process.stdout.write(
          `[이탈] fallback 군집 "${clusterOutput.clusters[session.currentClusterId].label}"으로 전환 (이탈 횟수: ${session.escapeCount})\n`,
        );
      }
    } else {
      break;
    }
  }

  const lastPhase2 = phase2Series[phase2Series.length - 1];

  if (verbose) {
    process.stdout.write(
      `[전체 완료] 총 비교 횟수: ${session.totalComparisons}, 이탈 횟수: ${session.escapeCount}\n`,
    );
  }

  const finalCluster = clusterOutput.clusters[session.currentClusterId];

  const report: ConvergenceReport = {
    success: lastPhase2?.converged ?? false,
    finalClusterId: session.currentClusterId,
    finalClusterLabel: finalCluster.label,
    topRecommendations: lastPhase2?.topProperties ?? [],
    phase1Comparisons: phase1.comparisons,
    phase2Comparisons: phase2Series.reduce((sum, p) => sum + p.comparisons, 0),
    totalComparisons: session.totalComparisons,
    escapeCount: session.escapeCount,
    cosineToHidden: lastPhase2?.cosineToHidden ?? null,
    convergedAt: new Date().toISOString(),
    forceTerminated,
  };

  return { session, phase1, phase2Series, report };
}

// ──────────────────────────────────────────────────────────
// 검증 유틸 (페르소나 테스트용)
// ──────────────────────────────────────────────────────────

/**
 * Top-1 매물이 특정 특징 차원에서 상위 30% 이내인지 확인
 * featureIdx: 확인할 특징 인덱스, higherIsBetter: true면 값이 클수록 좋음
 */
export function isTopInTopPercentile(
  topPropertyId: string,
  propertyMap: Map<string, Property>,
  stats: FeatureStats,
  commuteById: Map<string, CommuteFeatures>,
  featureIdx: number,
  higherIsBetter: boolean,
  percentile = 0.3,
): boolean {
  const allProps = [...propertyMap.values()];
  const allValues = allProps.map((p) => {
    const fv = toFeatureVector(p, stats, commuteById.get(p.id));
    return { id: p.id, val: fv[featureIdx] };
  });

  allValues.sort((a, b) => higherIsBetter ? b.val - a.val : a.val - b.val);
  const cutoff = Math.floor(allValues.length * percentile);
  const topSet = new Set(allValues.slice(0, cutoff).map((x) => x.id));
  return topSet.has(topPropertyId);
}

/**
 * Phase 1 결과가 페르소나에 맞는 군집을 선택했는지 확인
 * featureIdx: 페르소나의 핵심 특징 인덱스, higherIsBetter: 해당 feature가 높을수록 선호
 */
export function isCorrectClusterSelected(
  winnerClusterId: number,
  clusterOutput: ClusterBuildOutput,
  featureIdx: number,
  higherIsBetter: boolean,
): boolean {
  const clusterValues = clusterOutput.clusters.map((c) => ({
    id: c.clusterId,
    val: c.centroid[featureIdx],
  }));
  clusterValues.sort((a, b) => higherIsBetter ? b.val - a.val : a.val - b.val);
  // 상위 50% 이내 군집이면 올바른 선택으로 판단
  const cutoff = Math.ceil(clusterValues.length / 2);
  const topSet = new Set(clusterValues.slice(0, cutoff).map((x) => x.id));
  return topSet.has(winnerClusterId);
}
