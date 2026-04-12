import { FEATURE_DIM, type FeatureVector } from "./feature-engineer";

export interface RewardModel {
  dim: number;
  samples: FeatureVector[];
  comparisons: Array<{ phi: FeatureVector; preferred: 1 | -1 }>;
  /** 단위 구에 투영된 사전 평균 (기본 PRIOR 또는 사용자 슬라이더). MAP 정규화에 사용 */
  priorMean: FeatureVector;
}

const PRIOR_MEAN: FeatureVector = [
  -0.4,  // 월세 (낮을수록 좋음)
  -0.3,  // 보증금
  -0.3,  // 관리비
   0.1,  // 크기 (클수록 좋음)
   0.1,  // 방 개수
   0.0, 0.0, // 남향, 북향 (선호 없음)
   0.1,  // 주차
   0.2,  // CCTV
   0.1,  // 엘리베이터
   0.2,  // 년식 (yearScore 높을수록 최신 → 양의 선호)
   0.1,  // 기타옵션
  -0.2,  // 소음 (낮을수록 좋음)
   0.15, // 통학 도보 (짧을수록 φ↑)
   0.06, // 통학 버스 총시간 짧을수록 φ↑ (DB 분 단위 정규화)
];

const NUM_SAMPLES = 200;
const PROPOSAL_SIGMA = 0.05;
const BURN_IN = 50;

/** MAP: log N(w|μ₀) ∝ -(λ/2)||w-μ₀||². 비교가 적을수록 λ가 커져 초기 선호를 더 믿음 */
const PRIOR_LAMBDA_BASE = 14;

function sigmoid(x: number): number {
  if (x > 500) return 1;
  if (x < -500) return 0;
  return 1 / (1 + Math.exp(-x));
}

function dot(a: FeatureVector, b: FeatureVector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function norm(v: FeatureVector): number {
  return Math.sqrt(dot(v, v));
}

export function normalizeToUnitBall(v: FeatureVector): FeatureVector {
  const n = norm(v);
  if (n <= 1) return v;
  return v.map((x) => x / n);
}

export function randn(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

function logPosterior(
  w: FeatureVector,
  comparisons: RewardModel["comparisons"],
  priorMean: FeatureVector,
): number {
  const n = norm(w);
  if (n > 1) return -Infinity;

  let logP = 0;
  for (const { phi, preferred } of comparisons) {
    const s = preferred * dot(w, phi);
    logP += Math.log(sigmoid(s) + 1e-10);
  }

  let sqDist = 0;
  for (let i = 0; i < w.length; i++) {
    const d = w[i] - priorMean[i];
    sqDist += d * d;
  }
  const nComp = comparisons.length;
  const priorScale = PRIOR_LAMBDA_BASE / (1 + Math.sqrt(nComp));
  logP -= (priorScale / 2) * sqDist;

  return logP;
}

function mcmcSample(
  initial: FeatureVector,
  comparisons: RewardModel["comparisons"],
  numSamples: number,
  burnIn: number,
  priorMean: FeatureVector,
): FeatureVector[] {
  const dim = initial.length;
  let current = [...initial];
  let currentLogP = logPosterior(current, comparisons, priorMean);

  const samples: FeatureVector[] = [];
  const totalIter = numSamples + burnIn;

  let sigma = PROPOSAL_SIGMA;
  let accepted = 0;

  for (let iter = 0; iter < totalIter; iter++) {
    const proposal = current.map((x) => x + sigma * randn());
    const projected = normalizeToUnitBall(proposal);

    const proposalLogP = logPosterior(projected, comparisons, priorMean);
    const alpha = Math.min(1, Math.exp(proposalLogP - currentLogP));

    if (Math.random() < alpha) {
      current = projected;
      currentLogP = proposalLogP;
      accepted++;
    }

    if (iter >= burnIn) {
      samples.push([...current]);
    }

    if (iter > 0 && iter % 50 === 0) {
      const rate = accepted / (iter + 1);
      if (rate < 0.15) sigma *= 0.8;
      else if (rate > 0.5) sigma *= 1.2;
    }
  }

  return samples;
}

export function userWeightsToPrior(userWeights?: Record<string, number>): FeatureVector {
  if (!userWeights) return [...PRIOR_MEAN];

  const scale = (key: string, sign: number) => {
    const v = (userWeights[key] ?? 50) / 100;
    return sign * v * 0.5;
  };

  const d = ((userWeights.directionSouth ?? 50) - 50) / 100;

  return [
    -scale("monthlyRent", 1),     // 월세 (낮을수록 좋음 → 음수)
    -scale("deposit", 1),         // 보증금
    -scale("maintenanceFee", 1),  // 관리비
     scale("area", 1),            // 크기
     scale("rooms", 1),           // 방 개수
     d * 0.3,                      // 남향 (슬라이더 높을수록 남향 선호)
    -d * 0.3,                      // 북향
     scale("parking", 1),         // 주차
     scale("cctv", 1),            // CCTV
     scale("elevator", 1),        // 엘리베이터
     scale("year", 1),            // 년식
     scale("options", 1),         // 기타옵션
    -scale("noise", 1),           // 소음 (낮을수록 좋음 → 음수)
     scale("commute", 1),         // 통학 도보 (짧을수록 좋음)
     scale("busAvailable", 1),    // 버스 통학 총시간 (짧을수록 좋음, 슬라이더 키명 유지)
  ];
}

export function createModel(dim: number = FEATURE_DIM, userWeights?: Record<string, number>): RewardModel {
  const prior = userWeights ? userWeightsToPrior(userWeights) : PRIOR_MEAN.slice(0, dim);
  while (prior.length < dim) prior.push(0);

  const priorMean = normalizeToUnitBall([...prior]);
  const initial = normalizeToUnitBall(prior);
  const samples = mcmcSample(initial, [], NUM_SAMPLES, BURN_IN, priorMean);

  return { dim, samples, comparisons: [], priorMean };
}

export function updateModel(
  model: RewardModel,
  winnerFeatures: FeatureVector,
  loserFeatures: FeatureVector,
): RewardModel {
  const phi = winnerFeatures.map((w, i) => w - loserFeatures[i]);

  const comparisons = [...model.comparisons, { phi, preferred: 1 as const }];

  const meanW = getMeanWeight(model);
  const samples = mcmcSample(meanW, comparisons, NUM_SAMPLES, BURN_IN, model.priorMean);

  return { ...model, samples, comparisons };
}

export function predict(
  model: RewardModel,
  featuresA: FeatureVector,
  featuresB: FeatureVector,
): number {
  const w = getMeanWeight(model);
  const scoreA = dot(w, featuresA);
  const scoreB = dot(w, featuresB);
  return sigmoid(scoreA - scoreB);
}

export function scoreProperty(
  model: RewardModel,
  features: FeatureVector,
): number {
  const w = getMeanWeight(model);
  return dot(w, features);
}

export function scorePropertyThompson(
  model: RewardModel,
  features: FeatureVector,
): number {
  const idx = Math.floor(Math.random() * model.samples.length);
  const w = model.samples[idx];
  return dot(w, features);
}

export function getMeanWeight(model: RewardModel): FeatureVector {
  const dim = model.dim;
  const mean = new Array(dim).fill(0);
  for (const s of model.samples) {
    for (let i = 0; i < dim; i++) mean[i] += s[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= model.samples.length;
  return mean;
}

export function cosineSimilarity(a: FeatureVector, b: FeatureVector): number {
  const d = dot(a, b);
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return d / (na * nb);
}

export function posteriorConcentration(model: RewardModel): number {
  const mean = getMeanWeight(model);
  let totalSim = 0;
  for (const s of model.samples) {
    totalSim += cosineSimilarity(s, mean);
  }
  return totalSim / model.samples.length;
}
