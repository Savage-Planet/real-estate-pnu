/**
 * virtual-generator.ts
 * =====================
 * Sadigh et al. (2017) "Active Preference-Based Learning of Reward Functions" — RSS 2017
 *
 * 핵심 아이디어:
 *   실제 매물 없이 가상(합성) 아이템을 생성해 최대 정보량 질의를 합성한다.
 *   쌍 (A, B) 선택 기준:
 *     argmax P(A≻B) · P(B≻A)  ≡  argmin |P(A≻B) - 0.5|
 *   → 현재 posterior에서 가장 불확실한 쌍 = 선호 공간을 절반으로 가르는 쌍
 *
 * 두 가지 virtual item 유형:
 *   1. Category Archetypes (매크로 학습용): 한 카테고리만 극대, 나머지 중간값
 *   2. Sub-feature Archetypes (마이크로 학습용): 카테고리 내 특정 dim만 극대
 */

import type { CategoryVector } from "./feature-groups";
import { catDot, NUM_CATEGORIES } from "./feature-groups";
import type { MacroPosterior } from "./macro-learner";

// ──────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────

export interface VirtualItem {
  id: string;
  /** 4D 카테고리 점수 [거리, 가격, 안전, 편의성] */
  categoryVector: CategoryVector;
  /** 레이블 (콘솔 출력용) */
  label: string;
}

// ──────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  if (x > 500) return 1;
  if (x < -500) return 0;
  return 1 / (1 + Math.exp(-x));
}

// ──────────────────────────────────────────────────────────
// 카테고리 아키타입 생성 (매크로 학습용)
// ──────────────────────────────────────────────────────────

/**
 * 각 카테고리가 극대이고 나머지는 중간값(0.5)인 "순수 아키타입" 8개 생성.
 * - 단일 카테고리 4개: [1.0, 0.5, 0.5, 0.5] 형태
 * - 교차 혼합 4개: [0.9, 0.9, 0.3, 0.3] 등 → 비슷한 두 카테고리 간 분별력 확보
 */
export function generateCategoryArchetypes(): VirtualItem[] {
  const LABELS = ["거리", "가격", "안전", "편의성"];
  const HIGH = 1.0;
  const MID = 0.5;
  const LOW = 0.1;

  // 단일 카테고리 극대 아이템
  const single: VirtualItem[] = Array.from({ length: NUM_CATEGORIES }, (_, i) => {
    const cv = Array(NUM_CATEGORIES).fill(MID) as CategoryVector;
    cv[i] = HIGH;
    return { id: `archetype_single_${i}`, categoryVector: cv, label: `${LABELS[i]}중심형` };
  });

  // 두 카테고리 혼합 아이템 (C(4,2)=6개)
  const pairs: VirtualItem[] = [];
  for (let i = 0; i < NUM_CATEGORIES; i++) {
    for (let j = i + 1; j < NUM_CATEGORIES; j++) {
      const cv = Array(NUM_CATEGORIES).fill(LOW) as CategoryVector;
      cv[i] = 0.9;
      cv[j] = 0.9;
      pairs.push({
        id: `archetype_pair_${i}_${j}`,
        categoryVector: cv,
        label: `${LABELS[i]}+${LABELS[j]}형`,
      });
    }
  }

  return [...single, ...pairs];
}

// ──────────────────────────────────────────────────────────
// 정보량 최대 쌍 선택 (Sadigh 2017)
// ──────────────────────────────────────────────────────────

/**
 * 현재 MacroPosterior에서 P(A≻B)를 추정하여
 * |P(A≻B) - 0.5| 가 최소인 쌍을 반환.
 *
 * β(noise parameter): 사후 집중도가 높아질수록 신뢰도 높아짐 → 1~5 범위
 */
export function selectMostInfoPair(
  pool: VirtualItem[],
  posterior: MacroPosterior,
  beta = 2.0,
): [VirtualItem, VirtualItem] {
  const mean = getMacroMeanWeight(posterior);

  let bestPair: [VirtualItem, VirtualItem] = [pool[0], pool[1]];
  let minAmbiguity = Infinity;

  const usedKeys = posterior.usedPairKeys;

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const pairKey = `${pool[i].id}__${pool[j].id}`;
      if (usedKeys.has(pairKey)) continue;

      const delta = pool[i].categoryVector.map((v, k) => v - pool[j].categoryVector[k]) as CategoryVector;
      const logit = beta * catDot(mean, delta);
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
// 서브 특징 아키타입 (마이크로 학습용)
// ──────────────────────────────────────────────────────────

export interface SubVirtualItem {
  id: string;
  /** 서브 벡터 (카테고리 내 dim 수에 맞춰) */
  subVector: number[];
  label: string;
}

/**
 * 카테고리 내 dim별 극단값 아이템 생성
 * dimLabels: 해당 카테고리 dims의 이름 배열
 */
export function generateSubArchetypes(
  dimCount: number,
  dimLabels: string[],
): SubVirtualItem[] {
  const items: SubVirtualItem[] = [];
  const MID = 0.5;
  const HIGH = 1.0;
  const LOW = 0.0;

  // 단일 dim 극대
  for (let i = 0; i < dimCount; i++) {
    const hi = Array(dimCount).fill(MID) as number[];
    hi[i] = HIGH;
    items.push({ id: `sub_hi_${i}`, subVector: hi, label: `${dimLabels[i]}↑` });

    const lo = Array(dimCount).fill(MID) as number[];
    lo[i] = LOW;
    items.push({ id: `sub_lo_${i}`, subVector: lo, label: `${dimLabels[i]}↓` });
  }

  return items;
}

// ──────────────────────────────────────────────────────────
// Posterior 평균 (macro-learner.ts 참조용)
// ──────────────────────────────────────────────────────────

/** circular dependency 방지용 로컬 구현 */
function getMacroMeanWeight(posterior: MacroPosterior): CategoryVector {
  const n = posterior.samples.length;
  if (n === 0) return [0.25, 0.25, 0.25, 0.25];
  const sum = [0, 0, 0, 0];
  for (const s of posterior.samples) {
    for (let i = 0; i < 4; i++) sum[i] += s[i];
  }
  return sum.map((v) => v / n) as CategoryVector;
}
