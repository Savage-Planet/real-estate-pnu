/**
 * micro-learner.ts
 * =================
 * Level 2: 선택된 카테고리 내에서 서브 특징 가중치 학습
 *
 * 전략:
 *   - 카테고리 내 dims만 추출한 서브 벡터로 MCMC 실행 (차원 축소)
 *   - 실제 매물 비교 + 가상 아이템(sub-archetype) 혼합 사용
 *   - Sadigh 2017 기준으로 서브 아이템 pool에서 정보량 최대 쌍 선택
 *
 * 차원별 예상 수렴 (기본 상한 = dim*3+4):
 *   거리 (3D)  → ~10회
 *   가격 (3D)  → ~10회
 *   안전 (6D)  → ~22회
 *   편의 (8D)  → ~28회
 */

import type { Property } from "@/types";
import type { FeatureVector, FeatureStats, CommuteFeatures } from "@/lib/feature-engineer";
import { toFeatureVector } from "@/lib/feature-engineer";
import { randn, normalizeToUnitBall, cosineSimilarity } from "@/lib/reward-model";
import type { GroupKey } from "./feature-groups";
import { FEATURE_GROUPS, extractSubVector } from "./feature-groups";
import type { SubVirtualItem } from "./virtual-generator";
import { generateSubArchetypes } from "./virtual-generator";
import { bwmInitFromHidden } from "./bwm-initializer";

// ──────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────

export interface MicroPosterior {
  groupKey: GroupKey;
  /** 서브 차원 MCMC 샘플 */
  samples: number[][];
  /** 서브 차원 비교 */
  comparisons: Array<{ phi: number[]; preferred: 1 | -1 }>;
  /** 사전 평균 (서브 차원) */
  priorMean: number[];
}

export interface MicroResult {
  topProperties: Array<{ propertyId: string; score: number }>;
  comparisons: number;
  converged: boolean;
  posterior: MicroPosterior;
  cosineToHiddenSub: number | null;
  /** 비교 라운드별 코사인 유사도 (배치 분석용) */
  cosineHistory: number[];
  /** 코사인 0.9 첫 도달 비교 횟수 (미달성 시 null) */
  cosineReachedRound: number | null;
}

// ──────────────────────────────────────────────────────────
// 상수
// ──────────────────────────────────────────────────────────

const NUM_SAMPLES = 200;
const BURN_IN = 60;
const PROPOSAL_SIGMA = 0.06;
const CONCENTRATION_THRESHOLD = 0.92;

// ──────────────────────────────────────────────────────────
// MCMC (단위 구 위, 서브 차원)
// ──────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  if (x > 500) return 1;
  if (x < -500) return 0;
  return 1 / (1 + Math.exp(-x));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

function norm(v: number[]): number {
  return Math.sqrt(dot(v, v));
}

function logPosterior(
  w: number[],
  comparisons: MicroPosterior["comparisons"],
  priorMean: number[],
): number {
  const n = norm(w);
  if (n > 1 + 1e-6) return -Infinity;

  let logP = 0;
  for (const { phi, preferred } of comparisons) {
    logP += Math.log(sigmoid(preferred * dot(w, phi)) + 1e-10);
  }

  // 약한 사전 분포: priorMean 방향으로 약하게 당김
  const nComp = comparisons.length;
  const lambda = 8 / (1 + Math.sqrt(nComp));
  let sqDist = 0;
  for (let i = 0; i < w.length; i++) {
    const d = w[i] - priorMean[i];
    sqDist += d * d;
  }
  logP -= (lambda / 2) * sqDist;

  return logP;
}

function mcmcSubDim(
  initial: number[],
  comparisons: MicroPosterior["comparisons"],
  priorMean: number[],
  numSamples: number,
  burnIn: number,
): number[][] {
  let current = [...initial];
  let currentLogP = logPosterior(current, comparisons, priorMean);
  const samples: number[][] = [];
  const totalIter = numSamples + burnIn;
  let sigma = PROPOSAL_SIGMA;
  let accepted = 0;

  for (let iter = 0; iter < totalIter; iter++) {
    const raw = current.map((x) => x + sigma * randn());
    const proposed = normalizeToUnitBall(raw);

    const proposedLogP = logPosterior(proposed, comparisons, priorMean);
    const alpha = Math.min(1, Math.exp(proposedLogP - currentLogP));

    if (Math.random() < alpha) {
      current = proposed;
      currentLogP = proposedLogP;
      accepted++;
    }

    if (iter >= burnIn) samples.push([...current]);

    if (iter > 0 && iter % 50 === 0) {
      const rate = accepted / (iter + 1);
      if (rate < 0.15) sigma *= 0.8;
      else if (rate > 0.5) sigma *= 1.2;
    }
  }
  return samples;
}

// ──────────────────────────────────────────────────────────
// 공개 API
// ──────────────────────────────────────────────────────────

/** 카테고리 내 MCMC 초기화 */
export function createMicroPosterior(groupKey: GroupKey): MicroPosterior {
  const { dims } = FEATURE_GROUPS[groupKey];
  const dim = dims.length;
  // 균등 prior: 각 dim에 같은 가중치
  const priorMean = normalizeToUnitBall(Array(dim).fill(1 / dim));
  const initial = [...priorMean];
  const samples = mcmcSubDim(initial, [], priorMean, NUM_SAMPLES, BURN_IN);
  return { groupKey, samples, comparisons: [], priorMean };
}

/** 서브 차원 평균 가중치 */
export function getMicroMeanWeight(posterior: MicroPosterior): number[] {
  const n = posterior.samples.length;
  if (n === 0) return posterior.priorMean;
  const dim = posterior.samples[0].length;
  const sum = Array(dim).fill(0);
  for (const s of posterior.samples) {
    for (let i = 0; i < dim; i++) sum[i] += s[i];
  }
  return sum.map((v) => v / n);
}

/** 후험 집중도 */
export function microPosteriorConcentration(posterior: MicroPosterior): number {
  const mean = getMicroMeanWeight(posterior);
  const normMean = norm(mean);
  if (normMean === 0) return 0;
  let total = 0;
  for (const s of posterior.samples) {
    const normS = norm(s);
    if (normS === 0) continue;
    total += dot(s, mean) / (normS * normMean);
  }
  return total / posterior.samples.length;
}

/** 매물 서브 점수 계산 */
export function scorePropertySub(
  posterior: MicroPosterior,
  fv: FeatureVector,
): number {
  const sub = extractSubVector(fv, posterior.groupKey);
  const w = getMicroMeanWeight(posterior);
  return dot(w, sub);
}

/** 정보량 최대 쌍 선택 (Sadigh 2017, 서브 아이템 pool) */
export function selectMostInfoSubPair(
  pool: SubVirtualItem[],
  posterior: MicroPosterior,
  usedKeys: Set<string>,
  beta = 2.5,
): [SubVirtualItem, SubVirtualItem] | null {
  const mean = getMicroMeanWeight(posterior);
  let bestPair: [SubVirtualItem, SubVirtualItem] | null = null;
  let minAmbiguity = Infinity;

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const key = `${pool[i].id}__${pool[j].id}`;
      if (usedKeys.has(key)) continue;

      const delta = pool[i].subVector.map((v, k) => v - pool[j].subVector[k]);
      const logit = beta * dot(mean, delta);
      const pAB = sigmoid(logit);
      const ambiguity = Math.abs(pAB - 0.5);

      if (ambiguity < minAmbiguity) {
        minAmbiguity = ambiguity;
        bestPair = [pool[i], pool[j]];
      }
    }
  }
  return bestPair;
}

// ──────────────────────────────────────────────────────────
// 서브 차원 MCMC 업데이트
// ──────────────────────────────────────────────────────────

export function updateMicroPosterior(
  posterior: MicroPosterior,
  winnerSubVec: number[],
  loserSubVec: number[],
): MicroPosterior {
  const phi = winnerSubVec.map((v, i) => v - loserSubVec[i]);
  const comparisons = [...posterior.comparisons, { phi, preferred: 1 as const }];
  const mean = getMicroMeanWeight(posterior);
  const samples = mcmcSubDim(mean, comparisons, posterior.priorMean, NUM_SAMPLES, BURN_IN);
  return { ...posterior, samples, comparisons };
}

// ──────────────────────────────────────────────────────────
// 카테고리 내 탐색 실행
// ──────────────────────────────────────────────────────────

/** 카테고리 내 dim 이름 (콘솔 출력용) — 20D 기준 */
const DIM_LABELS: Record<GroupKey, string[]> = {
  distance:    ["통학도보", "통학버스", "경사도"],
  price:       ["월세", "보증금", "관리비"],
  safety:      ["CCTV", "소음↓", "방범창", "인터폰", "경비원", "카드키"],
  convenience: ["크기", "방수", "남향", "북향", "주차", "엘리베이터", "년식", "옵션"],
};

export interface RunMicroConfig {
  verbose?: boolean;
  topK?: number;
  escapeThreshold?: number;
  /** 최대 비교 횟수 오버라이드 (배치/배치 모드용) */
  maxComparisonsOverride?: number;
  /** 코사인 목표값 (기본 0.9) — 배치 모드에서 조기 종료 기준 */
  cosineTarget?: number;
  /**
   * BWM 사전 초기화 사용 여부 (기본 false)
   *
   * true이면 hiddenWeight의 서브 벡터에서 BWM 가중치를 도출하여
   * MCMC의 priorMean을 균등 분포 대신 BWM 가중치로 초기화한다.
   * 이론적으로 비교 횟수 ~30-40% 절감 예상.
   *
   * Rezaei (2015) Best-Worst Method 기반.
   */
  useBwmInit?: boolean;
}

export function runMicro(
  groupKey: GroupKey,
  members: Property[],
  stats: FeatureStats,
  commuteById: Map<string, CommuteFeatures>,
  hiddenWeight: FeatureVector,
  config: RunMicroConfig = {},
): MicroResult {
  const { verbose = false, topK = 3, maxComparisonsOverride, cosineTarget = 0.9, useBwmInit = false } = config;
  const { dims } = FEATURE_GROUPS[groupKey];
  const dim = dims.length;

  // hidden weight 서브 벡터 (시뮬레이션 검증용) — BWM 초기화 전에 먼저 계산
  const hiddenSub = extractSubVector(hiddenWeight, groupKey);

  // MCMC 사전 분포 초기화
  let posterior: MicroPosterior;
  if (useBwmInit && hiddenSub.length >= 2) {
    // BWM 가중치로 priorMean 초기화 (Rezaei 2015)
    const bwmWeights = bwmInitFromHidden(hiddenSub);
    const priorMean = normalizeToUnitBall(bwmWeights);
    const samples = mcmcSubDim(priorMean, [], priorMean, NUM_SAMPLES, BURN_IN);
    posterior = { groupKey, samples, comparisons: [], priorMean };
  } else {
    posterior = createMicroPosterior(groupKey);
  }

  // dim에 비례해 기본 상한 설정: 2D→10, 3D→14, 6D→22, 8D→26
  const maxComparisons = maxComparisonsOverride ?? (dim * 3 + 4);

  // 가상 아이템 pool 생성
  const virtualPool = generateSubArchetypes(dim, DIM_LABELS[groupKey]);
  const usedVirtualKeys = new Set<string>();
  /** 실제 매물 쌍 중복 방지 */
  const usedRealPairKeys = new Set<string>();

  // 실제 매물 서브 벡터 캐시
  const fvCache = new Map<string, FeatureVector>();
  const subCache = new Map<string, number[]>();
  for (const p of members) {
    const fv = toFeatureVector(p, stats, commuteById.get(p.id));
    fvCache.set(p.id, fv);
    subCache.set(p.id, extractSubVector(fv, groupKey));
  }

  let comparisons = 0;
  const cosineHistory: number[] = [];
  let cosineReachedRound: number | null = null;

  while (comparisons < maxComparisons) {
    let winnerSub: number[];
    let loserSub: number[];
    let labelA: string;
    let labelB: string;

    // 가상 아이템 우선 사용 (처음 몇 라운드)
    if (comparisons < Math.min(4, maxComparisons - 2)) {
      const pair = selectMostInfoSubPair(virtualPool, posterior, usedVirtualKeys);
      if (pair) {
        const [vA, vB] = pair;
        usedVirtualKeys.add(`${vA.id}__${vB.id}`);
        labelA = vA.label;
        labelB = vB.label;

        // 시뮬레이션: hidden weight로 winner 결정
        const scoreA = dot(hiddenSub, vA.subVector);
        const scoreB = dot(hiddenSub, vB.subVector);
        if (scoreA >= scoreB) {
          winnerSub = vA.subVector;
          loserSub = vB.subVector;
        } else {
          winnerSub = vB.subVector;
          loserSub = vA.subVector;
          [labelA, labelB] = [labelB, labelA];
        }
      } else {
        break;
      }
    } else {
      // 실제 매물에서 최대 정보 쌍 선택
      let bestPair: [string, string] | null = null;
      let minAmb = Infinity;
      const mean = getMicroMeanWeight(posterior);

      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const pairKey = `${members[i].id}__${members[j].id}`;
          if (usedRealPairKeys.has(pairKey)) continue;
          const sA = subCache.get(members[i].id)!;
          const sB = subCache.get(members[j].id)!;
          const delta = sA.map((v, k) => v - sB[k]);
          const logit = 2.5 * dot(mean, delta);
          const pAB = sigmoid(logit);
          const amb = Math.abs(pAB - 0.5);
          if (amb < minAmb) {
            minAmb = amb;
            bestPair = [members[i].id, members[j].id];
          }
        }
      }

      if (!bestPair) break;
      usedRealPairKeys.add(`${bestPair[0]}__${bestPair[1]}`);
      const [idA, idB] = bestPair;
      const sA = subCache.get(idA)!;
      const sB = subCache.get(idB)!;
      const scoreA = dot(hiddenSub, sA);
      const scoreB = dot(hiddenSub, sB);

      if (scoreA >= scoreB) {
        winnerSub = sA; loserSub = sB;
        labelA = idA.slice(0, 8); labelB = idB.slice(0, 8);
      } else {
        winnerSub = sB; loserSub = sA;
        labelA = idB.slice(0, 8); labelB = idA.slice(0, 8);
      }
    }

    posterior = updateMicroPosterior(posterior, winnerSub, loserSub);
    comparisons++;

    // 코사인 이력 기록
    const meanW = getMicroMeanWeight(posterior);
    const currentCos = hiddenSub.length === meanW.length ? cosineSimilarity(meanW, hiddenSub) : 0;
    cosineHistory.push(currentCos);
    if (cosineReachedRound === null && currentCos >= cosineTarget) {
      cosineReachedRound = comparisons;
    }

    if (verbose) {
      process.stdout.write(
        `[Micro ${groupKey}] 비교 ${comparisons}: ${labelA} vs ${labelB} → ${labelA} 선택 (집중도: ${microPosteriorConcentration(posterior).toFixed(3)}, cos: ${currentCos.toFixed(4)})\n`,
      );
    }

    if (microPosteriorConcentration(posterior) >= CONCENTRATION_THRESHOLD) break;
  }

  // Top-K 결과 계산
  const scored = members.map((p) => ({
    propertyId: p.id,
    score: scorePropertySub(posterior, fvCache.get(p.id)!),
  }));
  scored.sort((a, b) => b.score - a.score);
  const topProperties = scored.slice(0, topK);

  // 최종 코사인 유사도
  const finalMeanW = getMicroMeanWeight(posterior);
  const cosine = hiddenSub.length === finalMeanW.length ? cosineSimilarity(finalMeanW, hiddenSub) : null;

  return {
    topProperties,
    comparisons,
    converged: microPosteriorConcentration(posterior) >= CONCENTRATION_THRESHOLD,
    posterior,
    cosineToHiddenSub: cosine,
    cosineHistory,
    cosineReachedRound,
  };
}
