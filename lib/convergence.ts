import type { Property } from "@/types";
import type { RewardModel } from "./reward-model";
import { posteriorConcentration, scoreProperty } from "./reward-model";
import { type FeatureStats, toFeatureVector } from "./feature-engineer";
import { getMaxExpectedVolumeRemoval } from "./query-selector";

const TOP_K = 5;
const STABILITY_WINDOW = 3;
const VOLUME_THRESHOLD = 0.01;
const CONCENTRATION_THRESHOLD = 0.95;

export interface ConvergenceState {
  topKHistory: string[][];
  converged: boolean;
  reason: string | null;
  convergenceScore: number;
}

export function createConvergenceState(): ConvergenceState {
  return {
    topKHistory: [],
    converged: false,
    reason: null,
    convergenceScore: 0,
  };
}

function getTopK(
  model: RewardModel,
  candidates: Property[],
  stats: FeatureStats,
  k: number,
  commuteById?: Map<string, number>,
): string[] {
  const scored = candidates.map((p) => ({
    id: p.id,
    score: scoreProperty(model, toFeatureVector(p, stats, commuteById?.get(p.id))),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.id);
}

function topKStable(history: string[][]): boolean {
  if (history.length < STABILITY_WINDOW) return false;

  const recent = history.slice(-STABILITY_WINDOW);
  const reference = recent[0];

  for (let i = 1; i < recent.length; i++) {
    if (reference.length !== recent[i].length) return false;
    for (let j = 0; j < reference.length; j++) {
      if (reference[j] !== recent[i][j]) return false;
    }
  }

  return true;
}

export function checkConvergence(
  state: ConvergenceState,
  model: RewardModel,
  candidates: Property[],
  stats: FeatureStats,
  round: number,
  minRounds: number,
  maxRounds: number,
  commuteById?: Map<string, number>,
): ConvergenceState {
  const topK = getTopK(model, candidates, stats, TOP_K, commuteById);
  const history = [...state.topKHistory, topK];

  if (round < minRounds) {
    const progress = round / minRounds;
    return {
      topKHistory: history,
      converged: false,
      reason: null,
      convergenceScore: progress * 0.5,
    };
  }

  if (round >= maxRounds) {
    return {
      topKHistory: history,
      converged: true,
      reason: "최대 비교 횟수에 도달했습니다",
      convergenceScore: 1,
    };
  }

  const concentration = posteriorConcentration(model);
  const maxEvr = getMaxExpectedVolumeRemoval(model, candidates, stats, commuteById);
  const stable = topKStable(history);

  let reason: string | null = null;
  let converged = false;
  let score = 0.5;

  const concScore = Math.max(0, Math.min(concentration / CONCENTRATION_THRESHOLD, 1));
  const evrScore = Math.max(0, Math.min(1, (0.3 - maxEvr) / 0.29));
  const stabilityScore = stable ? 1 : (history.length >= 2 ? 0.5 : 0);

  score = 0.5 + 0.5 * (concScore * 0.4 + evrScore * 0.3 + stabilityScore * 0.3);
  score = Math.max(0, Math.min(1, score));

  if (stable) {
    converged = true;
    reason = "추천 순위가 안정화되었습니다";
  } else if (maxEvr < VOLUME_THRESHOLD) {
    converged = true;
    reason = "추가 비교의 정보 가치가 충분히 낮아졌습니다";
  } else if (concentration >= CONCENTRATION_THRESHOLD) {
    converged = true;
    reason = "선호도 모델이 충분히 수렴했습니다";
  }

  return {
    topKHistory: history,
    converged,
    reason,
    convergenceScore: Math.max(0, Math.min(score, 1)),
  };
}
