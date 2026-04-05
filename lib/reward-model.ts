import { FEATURE_DIM, type FeatureVector } from "./feature-engineer";

export interface RewardModel {
  dim: number;
  samples: FeatureVector[];
  comparisons: Array<{ phi: FeatureVector; preferred: 1 | -1 }>;
}

const PRIOR_MEAN: FeatureVector = [
  -0.4,  // 월세 (낮을수록 좋음)
  -0.3,  // 보증금
  -0.3,  // 관리비
   0.1,  // 크기 (클수록 좋음)
   0.1,  // 방 개수
   0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // 방향 8방위 (선호 없음)
   0.1,  // 주차
   0.2,  // CCTV
   0.1,  // 엘리베이터
   0.2,  // 년식 (yearScore 높을수록 최신 → 양의 선호)
   0.1,  // 기타옵션
  -0.2,  // 소음 (낮을수록 좋음)
];

const NUM_SAMPLES = 200;
const PROPOSAL_SIGMA = 0.05;
const BURN_IN = 50;

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

function normalizeToUnitBall(v: FeatureVector): FeatureVector {
  const n = norm(v);
  if (n <= 1) return v;
  return v.map((x) => x / n);
}

function randn(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

function logPosterior(
  w: FeatureVector,
  comparisons: RewardModel["comparisons"],
): number {
  const n = norm(w);
  if (n > 1) return -Infinity;

  let logP = 0;
  for (const { phi, preferred } of comparisons) {
    const s = preferred * dot(w, phi);
    logP += Math.log(sigmoid(s) + 1e-10);
  }

  return logP;
}

function mcmcSample(
  initial: FeatureVector,
  comparisons: RewardModel["comparisons"],
  numSamples: number,
  burnIn: number,
): FeatureVector[] {
  const dim = initial.length;
  let current = [...initial];
  let currentLogP = logPosterior(current, comparisons);

  const samples: FeatureVector[] = [];
  const totalIter = numSamples + burnIn;

  let sigma = PROPOSAL_SIGMA;
  let accepted = 0;

  for (let iter = 0; iter < totalIter; iter++) {
    const proposal = current.map((x) => x + sigma * randn());
    const projected = normalizeToUnitBall(proposal);

    const proposalLogP = logPosterior(projected, comparisons);
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

export function createModel(dim: number = FEATURE_DIM): RewardModel {
  const prior = PRIOR_MEAN.slice(0, dim);
  while (prior.length < dim) prior.push(0);

  const initial = normalizeToUnitBall(prior);
  const samples = mcmcSample(initial, [], NUM_SAMPLES, BURN_IN);

  return { dim, samples, comparisons: [] };
}

export function updateModel(
  model: RewardModel,
  winnerFeatures: FeatureVector,
  loserFeatures: FeatureVector,
): RewardModel {
  const phi = winnerFeatures.map((w, i) => w - loserFeatures[i]);

  const comparisons = [...model.comparisons, { phi, preferred: 1 as const }];

  const meanW = getMeanWeight(model);
  const samples = mcmcSample(meanW, comparisons, NUM_SAMPLES, BURN_IN);

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
