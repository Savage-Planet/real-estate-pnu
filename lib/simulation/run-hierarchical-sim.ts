/**
 * run-hierarchical-sim.ts
 * ========================
 * 계층적 모델 변형(H1~A4) 시뮬레이션
 *
 * 두 단계로 구성:
 *   Phase 1 (Macro): 4D 카테고리 가중치 학습
 *   Phase 2 (Micro): 선택된 카테고리 내 서브 특징 가중치 학습
 *
 * 코사인 유사도는 재구성된 20D 가중치와 hiddenW의 각도로 측정.
 * 이 측정치가 ≥ cosineTarget에 처음 도달한 라운드를 기록한다.
 *
 * 참고 논문:
 *   Oh, Lee, Ok (2019) AMPLe — comparison-based active preference learning
 *   Sadigh et al. (2017) — Active reward function learning with virtual items
 *   Rezaei (2015) — Best-Worst Method prior initialization
 *   Duchi et al. (2008) — Simplex projection
 *   Fürnkranz & Hüllermeier (2010) — Preference Learning: An Introduction
 */

import type { Property } from "@/types";
import type { FeatureStats, FeatureVector, CommuteFeatures } from "../feature-engineer";
import { FEATURE_DIM, toFeatureVector } from "../feature-engineer";
import { randn, normalizeToUnitBall, cosineSimilarity } from "../reward-model";
import type { CategoryVector } from "../hierarchical/v2/feature-groups";
import {
  FEATURE_GROUPS,
  GROUP_KEYS,
  toCategoryVector,
  weightToCategoryVector,
  extractSubVector,
  catDot,
  projectSimplex,
} from "../hierarchical/v2/feature-groups";
import {
  createMacroPosterior,
  updateMacroPosterior,
  getMacroMeanWeight,
  macroPosteriorConcentration,
  type MacroPosterior,
} from "../hierarchical/v2/macro-learner";
import {
  createMicroPosterior,
  updateMicroPosterior,
  getMicroMeanWeight,
  selectMostInfoSubPair,
  type MicroPosterior,
} from "../hierarchical/v2/micro-learner";
import {
  generateCategoryArchetypes,
  generateSubArchetypes,
  getTradeOffPairs,
  selectMostInfoPair,
  type VirtualItem,
  type SubVirtualItem,
} from "../hierarchical/v2/virtual-generator";
import { bwmInitFromHidden } from "../hierarchical/v2/bwm-initializer";
import type { VariantConfig } from "./variant-configs";

// ──────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────

export interface HierSimResult {
  cosineHistory: number[];          // 라운드별 코사인 유사도
  cosineReachedRound: number | null; // 코사인 ≥ target 첫 도달 라운드
  totalRounds: number;              // 총 비교 횟수 (macro + all micro)
  cosineMaxValue: number;
  macroRounds: number;
  microRoundsByCategory: number[];  // 카테고리별 micro 비교 횟수
}

// ──────────────────────────────────────────────────────────
// 상수
// ──────────────────────────────────────────────────────────

const MACRO_MAX_ROUNDS = 12;
const MICRO_MAX_PER_CATEGORY = 20;
const COSINE_TARGET_DEFAULT = 0.9;

const DIM_LABELS: Record<string, string[]> = {
  distance:    ["통학도보", "통학버스", "경사도"],
  price:       ["월세", "보증금", "관리비"],
  safety:      ["CCTV", "소음↓", "방범창", "인터폰", "경비원", "카드키"],
  convenience: ["크기", "방수", "남향", "북향", "주차", "엘리베이터", "년식", "옵션"],
};

// ──────────────────────────────────────────────────────────
// 유틸: 히든 가중치 생성
// ──────────────────────────────────────────────────────────

/**
 * 계층적으로 구조화된 히든 가중치 생성
 *
 * 실제 사용자 선호도는 계층 구조를 가진다는 가정 하에:
 *   1. 매크로 가중치(4D simplex) 랜덤 생성
 *   2. 각 카테고리 내 마이크로 가중치(서브 차원 unit ball) 랜덤 생성
 *   3. reconstructed[idx] = macroW[k] × microW_k[j] × sign
 *
 * 이 방식은 계층 모델이 학습하는 구조와 동일한 형태의 가중치를 생성한다.
 * Flat 모델도 동일한 구조의 히든 가중치를 학습하므로 공정한 비교가 가능하다.
 */
export function generateHierarchicalHiddenWeight(): FeatureVector {
  // 4D 매크로 가중치 (simplex)
  const rawMacro = Array.from({ length: 4 }, () => 0.1 + Math.random());
  const sumMacro = rawMacro.reduce((s, v) => s + v, 0);
  const macroW = rawMacro.map((v) => v / sumMacro);

  // 20D 재구성
  const full = new Array(FEATURE_DIM).fill(0) as FeatureVector;
  for (const key of GROUP_KEYS) {
    const { catIdx, dims } = FEATURE_GROUPS[key];
    const subDim = dims.length;

    // 서브 가중치: 양수값만 사용하여 각 카테고리 내 일관된 선호 방향 보장
    // abs(randn())로 모든 dim이 양수 방향(=더 좋음)을 가지도록 함
    const rawSub = Array.from({ length: subDim }, () => Math.abs(randn()) + 0.05);
    const normSub = Math.sqrt(rawSub.reduce((s, v) => s + v * v, 0)) || 1;
    const subW = rawSub.map((v) => v / normSub);

    for (let j = 0; j < dims.length; j++) {
      const { idx, invert } = dims[j];
      full[idx] = macroW[catIdx] * subW[j] * (invert ? -1 : 1);
    }
  }

  return normalizeToUnitBall(full);
}

// ──────────────────────────────────────────────────────────
// 유틸: 계층 가중치 → 20D 재구성
// ──────────────────────────────────────────────────────────

/**
 * 매크로(4D simplex) + 마이크로(서브 dim 가중치) 를 20D 특징 공간으로 재구성.
 * invert 처리를 역적용해 raw feature 공간과 일치시킨다.
 *
 * reconstructed[idx] = macroW[catIdx] × microW_k[j] × (invert ? -1 : 1)
 */
function reconstructFullWeight(
  macroW: CategoryVector,
  microWeights: Map<string, number[]>,
): FeatureVector {
  const full = new Array(FEATURE_DIM).fill(0) as FeatureVector;
  for (const key of GROUP_KEYS) {
    const { catIdx, dims } = FEATURE_GROUPS[key];
    const mw = macroW[catIdx];
    const subW = microWeights.get(key);
    for (let j = 0; j < dims.length; j++) {
      const { idx, invert } = dims[j];
      const subVal = subW ? subW[j] : 1 / dims.length;
      full[idx] = mw * subVal * (invert ? -1 : 1);
    }
  }
  return full;
}

// ──────────────────────────────────────────────────────────
// 단순 단위 구 MCMC (H1용: simplex 없이 4D 가중치 학습)
// ──────────────────────────────────────────────────────────

interface FlatMacroPosterior {
  samples: CategoryVector[];
  comparisons: Array<{ delta: CategoryVector; preferred: 1 | -1 }>;
  usedPairKeys: Set<string>;
}

function sigmoid(x: number): number {
  if (x > 500) return 1;
  if (x < -500) return 0;
  return 1 / (1 + Math.exp(-x));
}

function flatMacroLogP(
  w: CategoryVector,
  comparisons: Array<{ delta: CategoryVector; preferred: 1 | -1 }>,
): number {
  const n = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
  if (n > 1 + 1e-6) return -Infinity;
  let logP = 0;
  for (const { delta, preferred } of comparisons) {
    logP += Math.log(sigmoid(preferred * catDot(w, delta)) + 1e-10);
  }
  return logP;
}

function mcmcUnitBall4D(
  initial: CategoryVector,
  comparisons: Array<{ delta: CategoryVector; preferred: 1 | -1 }>,
  numSamples = 200,
  burnIn = 60,
  sigma = 0.06,
): CategoryVector[] {
  let current = [...initial] as CategoryVector;
  let currentLogP = flatMacroLogP(current, comparisons);
  const samples: CategoryVector[] = [];
  let accepted = 0;

  for (let iter = 0; iter < numSamples + burnIn; iter++) {
    const raw = current.map((x) => x + sigma * randn());
    const proposed = normalizeToUnitBall(raw) as CategoryVector;
    const proposedLogP = flatMacroLogP(proposed, comparisons);
    const alpha = Math.min(1, Math.exp(proposedLogP - currentLogP));
    if (Math.random() < alpha) {
      current = proposed;
      currentLogP = proposedLogP;
      accepted++;
    }
    if (iter >= burnIn) samples.push([...current] as CategoryVector);
    if (iter > 0 && iter % 50 === 0) {
      const rate = accepted / (iter + 1);
      if (rate < 0.15) sigma *= 0.8;
      else if (rate > 0.5) sigma *= 1.2;
    }
  }
  return samples;
}

function createFlatMacroPosterior(): FlatMacroPosterior {
  const initial: CategoryVector = [0, 0, 0, 0];
  const samples = mcmcUnitBall4D(initial, []);
  return { samples, comparisons: [], usedPairKeys: new Set() };
}

function updateFlatMacroPosterior(
  posterior: FlatMacroPosterior,
  winnerCV: CategoryVector,
  loserCV: CategoryVector,
): FlatMacroPosterior {
  const delta = winnerCV.map((v, i) => v - loserCV[i]) as CategoryVector;
  const comparisons = [...posterior.comparisons, { delta, preferred: 1 as const }];
  const mean = getFlatMacroMean(posterior);
  const samples = mcmcUnitBall4D(mean, comparisons);
  return { ...posterior, samples, comparisons };
}

function getFlatMacroMean(p: FlatMacroPosterior): CategoryVector {
  const n = p.samples.length;
  if (n === 0) return [0, 0, 0, 0];
  const sum = [0, 0, 0, 0];
  for (const s of p.samples) for (let i = 0; i < 4; i++) sum[i] += s[i];
  return sum.map((v) => v / n) as CategoryVector;
}

// ──────────────────────────────────────────────────────────
// 메인 시뮬레이션 함수
// ──────────────────────────────────────────────────────────

export function runHierarchicalSim(
  variantConfig: VariantConfig,
  properties: Property[],
  stats: FeatureStats,
  commuteById: Map<string, CommuteFeatures>,
  cosineTarget = COSINE_TARGET_DEFAULT,
  hiddenWOverride?: FeatureVector,
): HierSimResult {
  const hiddenW = hiddenWOverride ?? generateHierarchicalHiddenWeight();

  // 특징 벡터 캐시
  const fvCache = new Map<string, FeatureVector>();
  for (const p of properties) {
    fvCache.set(p.id, toFeatureVector(p, stats, commuteById.get(p.id)));
  }

  // hidden weight의 4D 카테고리 투영 (oracle 결정용)
  const hiddenCatW = weightToCategoryVector(hiddenW);

  // virtual item pool 생성
  const virtualPool = generateCategoryArchetypes();
  const tradeOffPairs = getTradeOffPairs(virtualPool);

  // 단순 H/L 아키타입 (H4용)
  const simpleArchetypes: VirtualItem[] = virtualPool.filter((v) =>
    v.id.startsWith("archetype_single_"),
  );

  const cosineHistory: number[] = [];
  let cosineReachedRound: number | null = null;
  let totalRound = 0;

  // 현재 마이크로 가중치 (모든 카테고리, 초기 균등)
  const microWeights = new Map<string, number[]>();
  for (const key of GROUP_KEYS) {
    const { dims } = FEATURE_GROUPS[key];
    microWeights.set(key, Array(dims.length).fill(1 / dims.length));
  }

  // 현재 매크로 가중치 (초기 균등)
  let macroW: CategoryVector = [0.25, 0.25, 0.25, 0.25];

  function recordCosine() {
    const reconstructed = reconstructFullWeight(macroW, microWeights);
    const cos = cosineSimilarity(reconstructed, hiddenW);
    cosineHistory.push(cos);
    totalRound++;
    if (cosineReachedRound === null && cos >= cosineTarget) {
      cosineReachedRound = totalRound;
    }
  }

  // ── Phase 1: Macro 학습 ──────────────────────────────────

  let macroRounds = 0;

  if (variantConfig.useSimplexMacro) {
    // H2-A4: simplex projection MCMC (AMPLe 방식)
    let macroPosterior: MacroPosterior = createMacroPosterior();

    for (let r = 0; r < MACRO_MAX_ROUNDS; r++) {
      let winnerCV: CategoryVector;
      let loserCV: CategoryVector;

      if (
        variantConfig.virtualItemMode === "tradeoff" &&
        r < tradeOffPairs.length
      ) {
        // A1-A4: Sadigh (2017) trade-off 가상 쌍
        const [vA, vB] = tradeOffPairs[r % tradeOffPairs.length];
        const pairKey = `${vA.id}__${vB.id}`;
        if (!macroPosterior.usedPairKeys.has(pairKey)) {
          macroPosterior.usedPairKeys.add(pairKey);
          const scoreA = catDot(hiddenCatW, vA.categoryVector);
          const scoreB = catDot(hiddenCatW, vB.categoryVector);
          if (scoreA >= scoreB) {
            winnerCV = vA.categoryVector;
            loserCV = vB.categoryVector;
          } else {
            winnerCV = vB.categoryVector;
            loserCV = vA.categoryVector;
          }
        } else {
          // 이미 사용된 쌍: 정보량 최대 쌍 재선택
          const [a, b] = selectMostInfoPair(virtualPool, macroPosterior);
          const scoreA = catDot(hiddenCatW, a.categoryVector);
          const scoreB = catDot(hiddenCatW, b.categoryVector);
          winnerCV = scoreA >= scoreB ? a.categoryVector : b.categoryVector;
          loserCV = scoreA >= scoreB ? b.categoryVector : a.categoryVector;
        }
      } else if (variantConfig.virtualItemMode === "simple") {
        // H4: HIGH/LOW 단순 아키타입
        const pair = selectMostInfoPair(simpleArchetypes.length >= 2 ? simpleArchetypes : virtualPool, macroPosterior);
        const [vA, vB] = pair;
        const scoreA = catDot(hiddenCatW, vA.categoryVector);
        const scoreB = catDot(hiddenCatW, vB.categoryVector);
        winnerCV = scoreA >= scoreB ? vA.categoryVector : vB.categoryVector;
        loserCV = scoreA >= scoreB ? vB.categoryVector : vA.categoryVector;
      } else {
        // H3: 랜덤 실제 매물 쌍 (no virtual items)
        const idxA = Math.floor(Math.random() * properties.length);
        let idxB = Math.floor(Math.random() * (properties.length - 1));
        if (idxB >= idxA) idxB++;
        const fvA = fvCache.get(properties[idxA].id)!;
        const fvB = fvCache.get(properties[idxB].id)!;
        const cvA = toCategoryVector(fvA);
        const cvB = toCategoryVector(fvB);
        const dotA = catDot(hiddenCatW, cvA);
        const dotB = catDot(hiddenCatW, cvB);
        winnerCV = dotA >= dotB ? cvA : cvB;
        loserCV = dotA >= dotB ? cvB : cvA;
      }

      macroPosterior = updateMacroPosterior(
        macroPosterior,
        winnerCV,
        loserCV,
        variantConfig.gamma,
      );
      macroW = getMacroMeanWeight(macroPosterior);
      macroRounds++;
      recordCosine();

      if (cosineReachedRound !== null) break;
      if (macroPosteriorConcentration(macroPosterior) >= 0.95) break;
    }
  } else {
    // H1: 단위 구 위 4D MCMC (simplex 없음)
    let flatPosterior: FlatMacroPosterior = createFlatMacroPosterior();

    for (let r = 0; r < MACRO_MAX_ROUNDS; r++) {
      // 랜덤 실제 매물 쌍
      const idxA = Math.floor(Math.random() * properties.length);
      let idxB = Math.floor(Math.random() * (properties.length - 1));
      if (idxB >= idxA) idxB++;
      const fvA = fvCache.get(properties[idxA].id)!;
      const fvB = fvCache.get(properties[idxB].id)!;
      const cvA = toCategoryVector(fvA);
      const cvB = toCategoryVector(fvB);
      const dotA = catDot(hiddenCatW, cvA);
      const dotB = catDot(hiddenCatW, cvB);
      const winnerCV = dotA >= dotB ? cvA : cvB;
      const loserCV = dotA >= dotB ? cvB : cvA;

      flatPosterior = updateFlatMacroPosterior(flatPosterior, winnerCV, loserCV);
      macroW = getFlatMacroMean(flatPosterior);
      macroRounds++;
      recordCosine();

      if (cosineReachedRound !== null) break;
    }
  }

  if (cosineReachedRound !== null) {
    return {
      cosineHistory,
      cosineReachedRound,
      totalRounds: totalRound,
      cosineMaxValue: Math.max(...cosineHistory),
      macroRounds,
      microRoundsByCategory: [],
    };
  }

  // ── Phase 2: Micro 학습 (top-2 카테고리) ─────────────────

  // macro가 수렴한 상위 2개 카테고리 선택
  const macroMean = macroW;
  const sortedCats = GROUP_KEYS.map((key, i) => ({
    key,
    weight: macroMean[FEATURE_GROUPS[key].catIdx],
  })).sort((a, b) => b.weight - a.weight);

  const microRoundsByCategory: number[] = [];

  for (const { key } of sortedCats.slice(0, 2)) {
    if (cosineReachedRound !== null) break;

    const { dims } = FEATURE_GROUPS[key];
    // 가중치 벡터에 올바른 변환 적용: invert ? -w[idx] : w[idx]
    // (extractSubVector는 특징값에 1-v를 적용하는 것으로 가중치에는 부적절)
    const hiddenSub = dims.map(({ idx, invert }) => invert ? -hiddenW[idx] : hiddenW[idx]);
    const virtualSubPool = generateSubArchetypes(dims.length, DIM_LABELS[key]);
    const usedVirtualKeys = new Set<string>();

    // BWM 사전 초기화 (A2+) — Rezaei (2015)
    let microPost: MicroPosterior;
    if (variantConfig.microPriorMode === "bwm") {
      const bwmWeights = bwmInitFromHidden(hiddenSub);
      const priorMean = normalizeToUnitBall(bwmWeights);
      // createMicroPosterior의 결과를 BWM priorMean으로 덮어쓰기
      microPost = { ...createMicroPosterior(key), priorMean };
    } else {
      microPost = createMicroPosterior(key);
    }

    let microRounds = 0;

    for (let mr = 0; mr < MICRO_MAX_PER_CATEGORY; mr++) {
      let winnerSub: number[];
      let loserSub: number[];

      if (mr < Math.min(4, MICRO_MAX_PER_CATEGORY - 2)) {
        // 가상 아이템 먼저 사용
        const subPair =
          variantConfig.microQueryMode === "ambiguity"
            ? selectMostInfoSubPair(virtualSubPool, microPost, usedVirtualKeys)
            : (() => {
                // 랜덤 가상 쌍 선택
                const available = virtualSubPool.filter(
                  (v, i) =>
                    !virtualSubPool
                      .slice(0, i)
                      .some(
                        (u) =>
                          usedVirtualKeys.has(`${u.id}__${v.id}`) ||
                          usedVirtualKeys.has(`${v.id}__${u.id}`),
                      ),
                );
                if (available.length < 2) return null;
                const ai = Math.floor(Math.random() * available.length);
                let bi = Math.floor(Math.random() * (available.length - 1));
                if (bi >= ai) bi++;
                return [available[ai], available[bi]] as [SubVirtualItem, SubVirtualItem];
              })();

        if (!subPair) break;
        const [vA, vB] = subPair;
        usedVirtualKeys.add(`${vA.id}__${vB.id}`);
        const scoreA = hiddenSub.reduce((s, v, k) => s + v * vA.subVector[k], 0);
        const scoreB = hiddenSub.reduce((s, v, k) => s + v * vB.subVector[k], 0);
        winnerSub = scoreA >= scoreB ? vA.subVector : vB.subVector;
        loserSub = scoreA >= scoreB ? vB.subVector : vA.subVector;
      } else {
        // 실제 매물 쌍 선택
        const realProps = properties;
        const subCache = new Map<string, number[]>();
        for (const p of realProps) {
          subCache.set(p.id, extractSubVector(fvCache.get(p.id)!, key));
        }

        let bestPair: [string, string] | null = null;

        if (variantConfig.microQueryMode === "ambiguity") {
          // 정보량 최대 쌍 (Sadigh 2017 ambiguity scoring)
          const mean = getMicroMeanWeight(microPost);
          let minAmb = Infinity;
          for (let i = 0; i < realProps.length; i++) {
            for (let j = i + 1; j < realProps.length; j++) {
              const sA = subCache.get(realProps[i].id)!;
              const sB = subCache.get(realProps[j].id)!;
              const delta = sA.map((v, k) => v - sB[k]);
              const logit = 2.5 * mean.reduce((s, v, k) => s + v * delta[k], 0);
              const pAB = sigmoid(logit);
              const amb = Math.abs(pAB - 0.5);
              if (amb < minAmb) {
                minAmb = amb;
                bestPair = [realProps[i].id, realProps[j].id];
              }
            }
          }
        } else {
          // 랜덤 쌍
          const ai = Math.floor(Math.random() * realProps.length);
          let bi = Math.floor(Math.random() * (realProps.length - 1));
          if (bi >= ai) bi++;
          bestPair = [realProps[ai].id, realProps[bi].id];
        }

        if (!bestPair) break;
        const sA = subCache.get(bestPair[0])!;
        const sB = subCache.get(bestPair[1])!;
        const scoreA = hiddenSub.reduce((s, v, k) => s + v * sA[k], 0);
        const scoreB = hiddenSub.reduce((s, v, k) => s + v * sB[k], 0);
        winnerSub = scoreA >= scoreB ? sA : sB;
        loserSub = scoreA >= scoreB ? sB : sA;
      }

      microPost = updateMicroPosterior(microPost, winnerSub, loserSub);
      microWeights.set(key, getMicroMeanWeight(microPost));
      microRounds++;
      recordCosine();
      if (cosineReachedRound !== null) break;
    }

    microRoundsByCategory.push(microRounds);
  }

  return {
    cosineHistory,
    cosineReachedRound,
    totalRounds: totalRound,
    cosineMaxValue: Math.max(...cosineHistory, 0),
    macroRounds,
    microRoundsByCategory,
  };
}
