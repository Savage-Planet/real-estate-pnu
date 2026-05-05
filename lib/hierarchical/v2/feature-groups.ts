/**
 * feature-groups.ts
 * ==================
 * 기존 15차원 특징 공간을 4개의 의미 카테고리로 분류.
 *
 * GAI (Generalized Additive Independence) 구조:
 *   U(p) = w₀·u_거리(p) + w₁·u_가격(p) + w₂·u_안전(p) + w₃·u_편의(p)
 *
 * ── 중요: "높은 카테고리 점수 = 해당 카테고리에서 좋은 매물" 원칙 ──
 *   - 가격: 월세·보증금·관리비 dim은 높을수록 비쌈(BAD) → invert=true
 *   - 안전: CCTV는 높을수록 좋음(GOOD), 소음은 높을수록 나쁨(BAD) → noise invert=true
 *   - 거리: feature-engineer에서 이미 "짧을수록 ↑" 정규화 → invert=false
 *   - 편의: 대부분 높을수록 좋음, 북향만 invert=true
 *
 * 이 원칙을 지키면 숨겨진 가중치(hidden weight)를 카테고리 공간으로 변환할 때
 * 선호하는 카테고리의 투영값이 양수(+)가 되어 올바른 카테고리 학습이 가능해진다.
 *
 * 참고:
 *   Dubois & Prade (1993) - Additive independence in multi-attribute utility
 *   Springer 2025 - Learning additive decompositions of multiattribute utility functions
 */

import type { FeatureVector } from "@/lib/feature-engineer";

// ──────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────

/** 4D 카테고리 가중치 벡터 [거리, 가격, 안전, 편의성] */
export type CategoryVector = [number, number, number, number];

export const CATEGORY_NAMES = ["거리", "가격", "안전", "편의성"] as const;
export type CategoryName = (typeof CATEGORY_NAMES)[number];
export const NUM_CATEGORIES = 4;

// ──────────────────────────────────────────────────────────
// 카테고리 → 15dim 매핑 (invert 정보 포함)
// ──────────────────────────────────────────────────────────

/**
 * 각 dim 항목:
 *   idx    - 15D 특징 벡터 인덱스
 *   invert - true이면 "1-v"(특징벡터) / "-v"(가중치벡터) 적용
 *            → 이 dim에서 "낮을수록 좋음"인 경우 true
 *
 *  dim 0:  월세        ← 높을수록 비쌈 → invert=true
 *  dim 1:  보증금      ← 높을수록 비쌈 → invert=true
 *  dim 2:  관리비      ← 높을수록 비쌈 → invert=true
 *  dim 3:  크기        ← 높을수록 좋음 → invert=false
 *  dim 4:  방 개수     ← 높을수록 좋음 → invert=false
 *  dim 5:  남향        ← 높을수록 좋음 → invert=false
 *  dim 6:  북향        ← 높을수록 나쁨 → invert=true
 *  dim 7:  주차        ← 높을수록 좋음 → invert=false
 *  dim 8:  CCTV       ← 높을수록 좋음 → invert=false
 *  dim 9:  엘리베이터  ← 높을수록 좋음 → invert=false
 *  dim 10: 년식 점수   ← 높을수록 최신 → invert=false
 *  dim 11: 기타옵션    ← 높을수록 좋음 → invert=false (has_closet + has_builtin_closet)
 *  dim 12: 소음        ← 높을수록 시끄러움 → invert=true
 *  dim 13: 통학 도보   ← feature-engineer가 "짧을수록↑" 처리 → invert=false
 *  dim 14: 통학 버스   ← feature-engineer가 "짧을수록↑" 처리 → invert=false
 *  dim 15: 방범창      ← 있을수록 좋음 → invert=false
 *  dim 16: 인터폰      ← 있을수록 좋음 → invert=false
 *  dim 17: 경비원      ← 있을수록 좋음 → invert=false
 *  dim 18: 카드키      ← 있을수록 좋음 → invert=false
 *  dim 19: 경사도      ← feature-engineer가 "완만할수록↑" 처리 → invert=false
 */
interface DimDef {
  idx: number;
  invert: boolean;
}

export const FEATURE_GROUPS: Record<string, { catIdx: number; dims: DimDef[]; label: string }> = {
  distance: {
    catIdx: 0,
    dims: [
      { idx: 13, invert: false }, // 통학 도보
      { idx: 14, invert: false }, // 통학 버스
      { idx: 19, invert: false }, // 경사도 (완만할수록↑ 처리 완료)
    ],
    label: "거리",
  },
  price: {
    catIdx: 1,
    dims: [
      { idx: 0, invert: true },
      { idx: 1, invert: true },
      { idx: 2, invert: true },
    ],
    label: "가격",
  },
  safety: {
    catIdx: 2,
    dims: [
      { idx: 8,  invert: false }, // CCTV
      { idx: 12, invert: true  }, // 소음
      { idx: 15, invert: false }, // 방범창
      { idx: 16, invert: false }, // 인터폰
      { idx: 17, invert: false }, // 경비원
      { idx: 18, invert: false }, // 카드키
    ],
    label: "안전",
  },
  convenience: {
    catIdx: 3,
    dims: [
      { idx: 3, invert: false },
      { idx: 4, invert: false },
      { idx: 5, invert: false },
      { idx: 6, invert: true },
      { idx: 7, invert: false },
      { idx: 9, invert: false },
      { idx: 10, invert: false },
      { idx: 11, invert: false },
    ],
    label: "편의성",
  },
};

export type GroupKey = keyof typeof FEATURE_GROUPS;
export const GROUP_KEYS: GroupKey[] = ["distance", "price", "safety", "convenience"];

// ──────────────────────────────────────────────────────────
// 변환 함수
// ──────────────────────────────────────────────────────────

/**
 * 15D 특징 벡터 → 4D 카테고리 점수 벡터
 * invert=true인 dim은 (1 - v)로 변환 → 높은 점수 = 해당 카테고리에서 좋은 매물
 *
 * 특징 벡터는 [0,1] 범위이므로 1-v 변환이 유효.
 */
export function toCategoryVector(fv: FeatureVector): CategoryVector {
  return GROUP_KEYS.map((key) => {
    const { dims } = FEATURE_GROUPS[key];
    const sum = dims.reduce((s, { idx, invert }) => {
      const v = fv[idx] ?? 0;
      return s + (invert ? 1 - v : v);
    }, 0);
    return sum / dims.length;
  }) as CategoryVector;
}

/**
 * 15D 숨겨진 가중치 벡터 → 4D 카테고리 선호도 벡터
 *
 * 가중치 벡터에 대한 invert는 부호 반전(-v):
 *   "월세 dim의 weight=-0.9" + "invert=true" → 0.9 (양수, 가격 카테고리 선호)
 *   "도보 dim의 weight=0.9" + "invert=false" → 0.9 (양수, 거리 카테고리 선호)
 *
 * 이로써 선호하는 카테고리의 투영값이 양수(+)가 되어 Level 1 학습이 올바르게 동작.
 */
export function weightToCategoryVector(w: FeatureVector): CategoryVector {
  return GROUP_KEYS.map((key) => {
    const { dims } = FEATURE_GROUPS[key];
    const sum = dims.reduce((s, { idx, invert }) => {
      const v = w[idx] ?? 0;
      return s + (invert ? -v : v);
    }, 0);
    return sum / dims.length;
  }) as CategoryVector;
}

/**
 * AMPLe의 Δr: 두 카테고리 벡터의 차이 (winner - loser)
 */
export function categoryDelta(cvA: CategoryVector, cvB: CategoryVector): CategoryVector {
  return cvA.map((v, i) => v - cvB[i]) as CategoryVector;
}

/**
 * 카테고리 벡터의 dot product
 */
export function catDot(w: CategoryVector, cv: CategoryVector): number {
  return w.reduce((s, wi, i) => s + wi * cv[i], 0);
}

/**
 * 4D simplex 투영 (Duchi et al. 2008 - 심플렉스 위 euclidean projection)
 * w_i >= 0, sum(w) = 1
 */
export function projectSimplex(v: number[]): CategoryVector {
  const n = v.length;
  const sorted = [...v].sort((a, b) => b - a);
  let rho = 0;
  let cumSum = 0;
  for (let i = 0; i < n; i++) {
    cumSum += sorted[i];
    if (sorted[i] - (cumSum - 1) / (i + 1) > 0) rho = i;
  }
  const cumSumRho = sorted.slice(0, rho + 1).reduce((s, x) => s + x, 0);
  const theta = (cumSumRho - 1) / (rho + 1);
  return v.map((x) => Math.max(0, x - theta)) as CategoryVector;
}

/**
 * 카테고리 인덱스 → GroupKey
 */
export function categoryIdxToKey(idx: number): GroupKey {
  return GROUP_KEYS[idx];
}

/**
 * 15D 특징 공간 위 카테고리별 서브 벡터 추출 (invert 적용)
 * 반환값도 "높을수록 좋음" 기준으로 정규화됨
 */
export function extractSubVector(fv: FeatureVector, groupKey: GroupKey): number[] {
  const { dims } = FEATURE_GROUPS[groupKey];
  return dims.map(({ idx, invert }) => {
    const v = fv[idx] ?? 0;
    return invert ? 1 - v : v;
  });
}
