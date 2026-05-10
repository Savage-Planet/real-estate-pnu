/**
 * virtual-generator.ts
 * =====================
 * Sadigh et al. (2017) "Active Preference-Based Learning of Reward Functions" — RSS 2017
 *
 * 핵심 아이디어:
 *   실제 매물 없이 가상(합성) 아이템을 생성해 최대 정보량 질의를 합성한다.
 *
 * Volume Removal (Sadigh 2017) 적용 방법:
 *   각 비교 쌍 (A, B)의 차이 벡터 d = vA - vB 가 현재 posterior 불확실 방향과
 *   정렬될수록 가중치 공간(version space)을 절반으로 가르는 hyperplane에 가까워진다.
 *
 *   trade-off pair 설계 원칙:
 *     - 비교하려는 두 카테고리 i, j 에서 item A = (HIGH_i, LOW_j, MID 나머지),
 *       item B = (LOW_i, HIGH_j, MID 나머지)로 설정
 *     - 나머지 차원은 동일(MID)하여 비교 외 노이즈 제거
 *     - 차이 벡터 d = [±0.9, ±0.9, 0, 0] → 단순 아키타입(±0.5) 대비 2배 분별력
 *
 * 두 가지 virtual item 유형:
 *   1. Trade-off Archetypes (매크로 학습 C(4,2)=6쌍용): 순수 두 카테고리 대결
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
// Trade-off 아키타입 생성 (매크로 학습용, Sadigh 2017 volume removal)
// ──────────────────────────────────────────────────────────

/**
 * C(4,2)=6 쌍에 대해 각각 순수 trade-off 아이템 쌍을 생성한다.
 *
 * 각 쌍 (i, j):
 *   - prefer_i: [i=0.95, j=0.05, 나머지=0.50]  (i 카테고리 극대, j 극소)
 *   - prefer_j: [i=0.05, j=0.95, 나머지=0.50]  (j 카테고리 극대, i 극소)
 *
 * 왜 HIGH=0.95 / LOW=0.05 / MID=0.50 인가?
 *   - 차이 벡터 |d_i| = 0.9 → 단순 아키타입(0.5 차이)의 1.8배 분별력
 *   - MID=0.50 는 비교 대상 외 차원의 noise를 제거
 *   - 0.05/0.95 는 현실 범위를 벗어나지 않아 construct feasibility 유지
 */
const HIGH = 0.95;
const LOW = 0.05;
const MID = 0.50;

export function generateCategoryArchetypes(): VirtualItem[] {
  const LABELS = ["거리", "가격", "안전", "편의성"];
  const items: VirtualItem[] = [];

  // 단일 카테고리 아키타입: legacy 호환 + interactive-navigator pickNextMacroPair 에서 직접 사용
  for (let i = 0; i < NUM_CATEGORIES; i++) {
    const cv = Array(NUM_CATEGORIES).fill(MID) as CategoryVector;
    cv[i] = HIGH;
    items.push({ id: `archetype_single_${i}`, categoryVector: cv, label: `${LABELS[i]}중심형` });
  }

  // Trade-off 아이템: C(4,2) × 2 = 12개
  for (let i = 0; i < NUM_CATEGORIES; i++) {
    for (let j = i + 1; j < NUM_CATEGORIES; j++) {
      const cvA = Array(NUM_CATEGORIES).fill(MID) as CategoryVector;
      cvA[i] = HIGH; cvA[j] = LOW;
      items.push({
        id: `tradeoff_${i}_${j}_a`,
        categoryVector: cvA,
        label: `${LABELS[i]}↑${LABELS[j]}↓형`,
      });

      const cvB = Array(NUM_CATEGORIES).fill(MID) as CategoryVector;
      cvB[i] = LOW; cvB[j] = HIGH;
      items.push({
        id: `tradeoff_${i}_${j}_b`,
        categoryVector: cvB,
        label: `${LABELS[i]}↓${LABELS[j]}↑형`,
      });
    }
  }

  return items;
}

/**
 * 6 고정 쌍에 대한 trade-off 아이템 쌍을 반환한다.
 * pickNextMacroPair() 에서 직접 사용.
 * 반환값: [pair 인덱스 → [prefer_i 아이템, prefer_j 아이템]] 배열 (6개)
 */
export function getTradeOffPairs(pool: VirtualItem[]): Array<[VirtualItem, VirtualItem]> {
  const PAIRS: [number, number][] = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
  return PAIRS.map(([i, j]) => {
    const a = pool.find((v) => v.id === `tradeoff_${i}_${j}_a`);
    const b = pool.find((v) => v.id === `tradeoff_${i}_${j}_b`);
    if (!a || !b) throw new Error(`trade-off pair ${i}_${j} not found`);
    return [a, b];
  });
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
