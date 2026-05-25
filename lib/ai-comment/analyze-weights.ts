/**
 * Pure analytics module — no Gemini, no I/O.
 * Takes a 22-dim weight vector and extracts structured insights
 * used to populate the bias pamphlet template.
 */

export const FEATURE_NAMES_KO = [
  "월세",          // 0
  "보증금",        // 1
  "관리비",        // 2
  "크기",          // 3
  "방 개수",       // 4
  "남향",          // 5
  "북향",          // 6
  "주차",          // 7
  "CCTV",          // 8
  "엘리베이터",   // 9
  "년식",          // 10
  "기타옵션",     // 11
  "소음",          // 12
  "통학(도보)",   // 13
  "통학(버스)",   // 14
  "방범창",        // 15
  "인터폰",        // 16
  "경비원",        // 17
  "카드키",        // 18
  "경사도",        // 19
  "벌레 지수",    // 20
  "가로등",        // 21
] as const;

export type FeatureName = (typeof FEATURE_NAMES_KO)[number];

// Index groups for bias detection
const IDX = {
  price:   [0, 1, 2],           // 월세, 보증금, 관리비
  safety:  [8, 15, 17, 18],    // CCTV, 방범창, 경비원, 카드키
  commute: [13, 14],            // 통학(도보), 통학(버스)
  env:     [12, 19, 20, 21],   // 소음, 경사도, 벌레지수, 가로등
} as const;

export type BiasType =
  | "가격집착형"
  | "안전우선형"
  | "통학최우선형"
  | "속성지배형"
  | "환경민감형"
  | "균형형";

export interface FeatureEntry {
  name: string;
  weight: number;
  index: number;
}

export interface DeltaEntry {
  name: string;
  initial: number;
  final: number;
  delta: number;
}

export interface TopPropertyInfo {
  rank1Summary: string;
  rank1Score: number;
  rank2Summary?: string;
  rank2Score?: number;
}

export interface WeightAnalytics {
  /** Top 5 most positive-weighted features */
  topFeatures: (FeatureEntry & { rank: number })[];
  /** 3 most negative or lowest-weighted features */
  bottomFeatures: FeatureEntry[];
  /** Top 3 features by |delta| from initial weights */
  bigDeltas: DeltaEntry[];
  dominantBias: BiasType;
  /** Human-readable evidence string, e.g. "월세(2.4) + 보증금(1.8) = 전체의 47%" */
  biasEvidence: string;
  /** Group share percentages for all bias groups */
  groupShares: Record<keyof typeof IDX, number>;
  topProperty: TopPropertyInfo | null;
  /** Raw sorted weights for display */
  sortedByAbsWeight: FeatureEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────

function groupShare(weights: number[], indices: readonly number[]): number {
  const total = weights.reduce((s, w) => s + Math.abs(w), 0);
  if (total === 0) return 0;
  const groupSum = indices.reduce((s, i) => s + Math.abs(weights[i] ?? 0), 0);
  return groupSum / total;
}

function fmt(w: number): string {
  return w.toFixed(2);
}

function buildBiasEvidence(
  weights: number[],
  bias: BiasType,
): string {
  const total = weights.reduce((s, w) => s + Math.abs(w), 0);

  if (bias === "균형형") {
    return "특정 항목에 치우치지 않고 여러 속성을 고르게 고려했습니다.";
  }

  const indices = {
    가격집착형:    IDX.price,
    안전우선형:    IDX.safety,
    통학최우선형:  IDX.commute,
    환경민감형:    IDX.env,
    속성지배형:    [] as number[],
    균형형:        [] as number[],
  }[bias] as number[];

  if (bias === "속성지배형") {
    const sorted = [...weights.entries()]
      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));
    const top1 = sorted[0];
    const top2 = sorted[1];
    const name1 = FEATURE_NAMES_KO[top1[0]];
    const name2 = FEATURE_NAMES_KO[top2[0]];
    const share = Math.round((Math.abs(top1[1]) / (total || 1)) * 100);
    return `${name1}(${fmt(top1[1])})이 전체 가중치의 ${share}%를 차지하며, 2위 ${name2}(${fmt(top2[1])})의 ${(Math.abs(top1[1]) / (Math.abs(top2[1]) || 1)).toFixed(1)}배입니다.`;
  }

  const parts = indices
    .map((i) => `${FEATURE_NAMES_KO[i]}(${fmt(weights[i] ?? 0)})`)
    .join(" + ");
  const groupSum = indices.reduce((s, i) => s + Math.abs(weights[i] ?? 0), 0);
  const pct = Math.round((groupSum / (total || 1)) * 100);
  return `${parts} = 전체의 ${pct}%`;
}

// ─────────────────────────────────────────────────────────────────────────────

export function analyzeWeights(
  weights: number[],
  initialWeights?: number[],
  topProperty: TopPropertyInfo | null = null,
): WeightAnalytics {
  const padded = Array.from({ length: 22 }, (_, i) => weights[i] ?? 0);

  // Sorted by absolute weight descending
  const sortedByAbsWeight: FeatureEntry[] = padded
    .map((w, i) => ({ name: FEATURE_NAMES_KO[i] ?? `dim${i}`, weight: w, index: i }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  const topFeatures = sortedByAbsWeight
    .filter((e) => e.weight > 0)
    .slice(0, 5)
    .map((e, rank) => ({ ...e, rank: rank + 1 }));

  const bottomFeatures = [...sortedByAbsWeight]
    .reverse()
    .filter((e) => e.weight <= 0)
    .slice(0, 3);

  // If no explicit negatives, take lowest positive weights
  const effectiveBottom =
    bottomFeatures.length >= 2
      ? bottomFeatures
      : [...sortedByAbsWeight].reverse().slice(0, 3);

  // Delta analysis
  let bigDeltas: DeltaEntry[] = [];
  if (initialWeights) {
    const paddedInit = Array.from({ length: 22 }, (_, i) => initialWeights[i] ?? 0);
    bigDeltas = padded
      .map((final, i) => ({
        name: FEATURE_NAMES_KO[i] ?? `dim${i}`,
        initial: paddedInit[i],
        final,
        delta: final - paddedInit[i],
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 3);
  }

  // Group shares
  const groupShares = {
    price:   groupShare(padded, IDX.price),
    safety:  groupShare(padded, IDX.safety),
    commute: groupShare(padded, IDX.commute),
    env:     groupShare(padded, IDX.env),
  };

  // Check attribute dominance
  const top2 = sortedByAbsWeight.slice(0, 2);
  const isAttributeDominant =
    top2.length === 2 &&
    Math.abs(top2[0].weight) >= Math.abs(top2[1].weight) * 2;

  // Determine dominant bias
  let dominantBias: BiasType = "균형형";
  const THRESHOLDS = {
    price:   0.40,
    safety:  0.20,
    commute: 0.25,
    env:     0.20,
  };

  const ordered: [BiasType, number][] = [
    ["가격집착형",   groupShares.price],
    ["안전우선형",   groupShares.safety],
    ["통학최우선형", groupShares.commute],
    ["환경민감형",   groupShares.env],
  ];

  // Pick whichever share exceeds threshold by the largest margin
  let bestExcess = 0;
  for (const [biasName, share] of ordered) {
    const threshold = THRESHOLDS[
      biasName === "가격집착형"   ? "price"
      : biasName === "안전우선형" ? "safety"
      : biasName === "통학최우선형" ? "commute"
      : "env"
    ];
    const excess = share - threshold;
    if (excess > 0 && excess > bestExcess) {
      bestExcess = excess;
      dominantBias = biasName;
    }
  }

  if (dominantBias === "균형형" && isAttributeDominant) {
    dominantBias = "속성지배형";
  }

  const biasEvidence = buildBiasEvidence(padded, dominantBias);

  return {
    topFeatures,
    bottomFeatures: effectiveBottom,
    bigDeltas,
    dominantBias,
    biasEvidence,
    groupShares,
    topProperty,
    sortedByAbsWeight,
  };
}
