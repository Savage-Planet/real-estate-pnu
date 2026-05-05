/**
 * macro-learner.ts
 * =================
 * Level 1: 4D 카테고리 가중치 학습 (AMPLe 방식)
 *
 * 참고:
 *   Oh, Lee, Ok (2024/2025) "Comparison-based Active Preference Learning
 *   for Multi-dimensional Personalization" — POSTECH, ACL 2025
 *
 * 핵심:
 *   1. 사용자 프로파일 w ∈ Δ³ (4D simplex) 위에서 posterior 유지
 *   2. 수정 사후 갱신: P_t(w) ∝ P_{t-1}(w) · σ(β · y_t · ⟨w, Δr⟩)^γ
 *      γ ∈ (0,1) = 편향 보정 감쇠 지수 (AMPLe 논문 권장: 0.7)
 *   3. 수렴 조건: 사후 집중도(posterior concentration) ≥ 임계값
 */

import type { CategoryVector } from "./feature-groups";
import { catDot, projectSimplex, NUM_CATEGORIES } from "./feature-groups";

// ──────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────

export interface MacroPosterior {
  /** Simplex 위 MCMC 샘플 */
  samples: CategoryVector[];
  /** 누적 비교 데이터 */
  comparisons: Array<{ delta: CategoryVector; preferred: 1 | -1 }>;
  /** 이미 사용한 가상 쌍 키 (재사용 방지) */
  usedPairKeys: Set<string>;
}

// ──────────────────────────────────────────────────────────
// 상수
// ──────────────────────────────────────────────────────────

const NUM_SAMPLES = 300;
const BURN_IN = 80;
const PROPOSAL_SIGMA = 0.08;
/** AMPLe 논문 권장 감쇠 지수 */
const GAMMA_DEFAULT = 0.7;
/** noise parameter: 높을수록 비교가 결정적 */
const BETA_DEFAULT = 3.0;

// ──────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  if (x > 500) return 1;
  if (x < -500) return 0;
  return 1 / (1 + Math.exp(-x));
}

function randn(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

// ──────────────────────────────────────────────────────────
// Log-posterior (AMPLe 수정 버전)
// ──────────────────────────────────────────────────────────

/**
 * AMPLe의 수정 log-posterior:
 *   log P(w | data) = Σ_t γ · log σ(β · y_t · ⟨w, Δr_t⟩) + log P₀(w)
 *
 * γ는 over-confident posterior를 억제해 편향을 줄임.
 * P₀(w) = uniform over simplex (improper prior, enforced by simplex projection)
 */
function logPosteriorMacro(
  w: CategoryVector,
  comparisons: MacroPosterior["comparisons"],
  gamma = GAMMA_DEFAULT,
  beta = BETA_DEFAULT,
): number {
  // simplex 외부 → -Infinity
  if (w.some((wi) => wi < -1e-6)) return -Infinity;
  const sumW = w.reduce((s, x) => s + x, 0);
  if (Math.abs(sumW - 1.0) > 0.01) return -Infinity;

  let logP = 0;
  for (const { delta, preferred } of comparisons) {
    const logit = beta * preferred * catDot(w, delta);
    logP += gamma * Math.log(sigmoid(logit) + 1e-10);
  }
  return logP;
}

// ──────────────────────────────────────────────────────────
// MCMC (Metropolis-Hastings on Simplex)
// ──────────────────────────────────────────────────────────

function mcmcSimplex(
  initial: CategoryVector,
  comparisons: MacroPosterior["comparisons"],
  numSamples: number,
  burnIn: number,
  gamma: number,
  beta: number,
): CategoryVector[] {
  let current = [...initial] as CategoryVector;
  let currentLogP = logPosteriorMacro(current, comparisons, gamma, beta);
  const samples: CategoryVector[] = [];
  const totalIter = numSamples + burnIn;
  let sigma = PROPOSAL_SIGMA;
  let accepted = 0;

  for (let iter = 0; iter < totalIter; iter++) {
    // 제안 분포: 현재 w에 Gaussian 노이즈 추가 후 simplex 투영
    const raw = current.map((x) => x + sigma * randn());
    const proposed = projectSimplex(raw);

    const proposedLogP = logPosteriorMacro(proposed, comparisons, gamma, beta);
    const alpha = Math.min(1, Math.exp(proposedLogP - currentLogP));

    if (Math.random() < alpha) {
      current = proposed;
      currentLogP = proposedLogP;
      accepted++;
    }

    if (iter >= burnIn) samples.push([...current]);

    // 적응형 step size
    if (iter > 0 && iter % 60 === 0) {
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

/** 초기 posterior: uniform simplex (균등 분포) */
export function createMacroPosterior(): MacroPosterior {
  const initial: CategoryVector = [0.25, 0.25, 0.25, 0.25];
  const samples = mcmcSimplex(initial, [], NUM_SAMPLES, BURN_IN, GAMMA_DEFAULT, BETA_DEFAULT);
  return { samples, comparisons: [], usedPairKeys: new Set() };
}

/**
 * 사용자 서열(ranking) 기반 prior로 초기화된 MacroPosterior
 *
 * ranking: 카테고리 인덱스 배열 (중요도 순, 앞쪽이 더 중요)
 *   예: [1, 0, 2, 3] → 가격 > 거리 > 안전 > 편의성
 *   부분 서열도 허용: [2, 0] → 안전 > 거리 > (나머지 균등)
 *
 * Borda count 변환:
 *   순위 1위 → 가중치 n, 2위 → n-1, ... 미지정 → 1
 *   정규화 후 simplex 투영
 */
export function createMacroPosteriorWithPrior(ranking: number[]): MacroPosterior {
  const n = NUM_CATEGORIES;
  const scores = Array(n).fill(1) as number[]; // 기본값 1 (미지정)
  const rankedSet = new Set(ranking);

  // Borda 점수 부여
  for (let i = 0; i < ranking.length; i++) {
    const catIdx = ranking[i];
    if (catIdx >= 0 && catIdx < n) {
      scores[catIdx] = n - i; // 1위=4, 2위=3, 3위=2, 4위=1
    }
  }
  // 미지정 카테고리는 1 유지 (이미 초기화됨)

  // simplex 정규화
  const sum = scores.reduce((s, v) => s + v, 0);
  const initial = scores.map((v) => v / sum) as CategoryVector;

  const samples = mcmcSimplex(initial, [], NUM_SAMPLES, BURN_IN, GAMMA_DEFAULT, BETA_DEFAULT);
  return { samples, comparisons: [], usedPairKeys: new Set() };
}

/**
 * AMPLe 수정 사후 갱신:
 *   winner > loser 비교 결과를 반영해 posterior 업데이트
 */
export function updateMacroPosterior(
  posterior: MacroPosterior,
  winnerCV: CategoryVector,
  loserCV: CategoryVector,
  gamma = GAMMA_DEFAULT,
  beta = BETA_DEFAULT,
): MacroPosterior {
  const delta = winnerCV.map((v, i) => v - loserCV[i]) as CategoryVector;
  const comparisons = [...posterior.comparisons, { delta, preferred: 1 as const }];
  const mean = getMacroMeanWeight({ ...posterior, comparisons });
  const samples = mcmcSimplex(mean, comparisons, NUM_SAMPLES, BURN_IN, gamma, beta);
  return { ...posterior, samples, comparisons };
}

/** 평균 카테고리 가중치 벡터 */
export function getMacroMeanWeight(posterior: MacroPosterior): CategoryVector {
  const n = posterior.samples.length;
  if (n === 0) return [0.25, 0.25, 0.25, 0.25];
  const sum = [0, 0, 0, 0];
  for (const s of posterior.samples) {
    for (let i = 0; i < NUM_CATEGORIES; i++) sum[i] += s[i];
  }
  return sum.map((v) => v / n) as CategoryVector;
}

/**
 * 사후 집중도:
 *   각 샘플과 평균의 코사인 유사도 평균 → 1에 가까울수록 수렴
 */
export function macroPosteriorConcentration(posterior: MacroPosterior): number {
  const mean = getMacroMeanWeight(posterior);
  const normMean = Math.sqrt(mean.reduce((s, x) => s + x * x, 0));
  if (normMean === 0) return 0;

  let totalSim = 0;
  for (const s of posterior.samples) {
    const normS = Math.sqrt(s.reduce((sum, x) => sum + x * x, 0));
    if (normS === 0) continue;
    const cos = s.reduce((sum, x, i) => sum + x * mean[i], 0) / (normS * normMean);
    totalSim += cos;
  }
  return totalSim / posterior.samples.length;
}

/**
 * 수렴 판정:
 *   - 집중도 ≥ 0.95, 또는
 *   - 비교 횟수 ≥ maxComparisons
 */
export function isMacroConverged(
  posterior: MacroPosterior,
  maxComparisons = 10,
  concentrationThreshold = 0.92,
): boolean {
  if (posterior.comparisons.length >= maxComparisons) return true;
  return macroPosteriorConcentration(posterior) >= concentrationThreshold;
}

/** 1위 카테고리 인덱스 */
export function topCategoryIdx(posterior: MacroPosterior): number {
  const mean = getMacroMeanWeight(posterior);
  return mean.indexOf(Math.max(...mean));
}

/** 2위 카테고리 인덱스 */
export function secondCategoryIdx(posterior: MacroPosterior): number {
  const mean = getMacroMeanWeight(posterior);
  const sorted = [...mean].map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  return sorted[1].i;
}
