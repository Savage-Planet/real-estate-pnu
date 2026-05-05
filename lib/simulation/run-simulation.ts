import type { Property } from "@/types";
import type { CommuteFeatures, FeatureStats, FeatureVector } from "../feature-engineer";
import { FEATURE_DIM, toFeatureVector } from "../feature-engineer";
import {
  createModel,
  updateModel,
  getMeanWeight,
  scoreProperty,
  cosineSimilarity,
  normalizeToUnitBall,
  randn,
  type RewardModel,
} from "../reward-model";
import { selectPair } from "../query-selector";
import { computeRoundMetrics, type RoundMetrics } from "../convergence";

export interface SimulationConfig {
  candidateCount: number;
  minRounds: number;
  absoluteMaxRounds: number;
  hiddenMatchCosine: number;
  initialWeights?: Record<string, number>;
  silent?: boolean;
}

export interface SimulationResult {
  meta: {
    candidateCount: number;
    minRounds: number;
    absoluteMaxRounds: number;
    hiddenMatchCosine: number;
    hiddenWeights: number[];
    initialPrior: number[];
    totalRounds: number;
    cosineReachedRound: number | null;
    cosineMaxValue: number;
    cosineMaxRound: number;
    convergenceReason: string | null;
    convergenceRound: number | null;
  };
  series: Array<
    RoundMetrics & {
      cosineToHidden: number;
    }
  >;
}

function dot(a: FeatureVector, b: FeatureVector): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function generateRandomUnitBallVector(dim: number): FeatureVector {
  const raw = Array.from({ length: dim }, () => randn());
  const scale = 0.3 + Math.random() * 0.7;
  return normalizeToUnitBall(raw.map((x) => x * scale));
}

function generateRandomSliderWeights(): Record<string, number> {
  const keys = [
    "monthlyRent", "deposit", "maintenanceFee", "area", "rooms",
    "directionSouth", "parking", "cctv", "elevator", "year",
    "options", "noise", "commute", "busAvailable",
  ];
  const w: Record<string, number> = {};
  for (const k of keys) w[k] = Math.round(Math.random() * 100);
  return w;
}

export function runSimulation(
  config: SimulationConfig,
  properties: Property[],
  stats: FeatureStats,
  commuteById: Map<string, CommuteFeatures>,
): SimulationResult {
  const dim = FEATURE_DIM;
  const hiddenW = generateRandomUnitBallVector(dim);
  const initialSliders = config.initialWeights ?? generateRandomSliderWeights();

  let model: RewardModel = createModel(dim, initialSliders);
  const initialPrior = getMeanWeight(model);

  const usedPairs = new Set<string>();
  let topKHistory: string[][] = [];
  const series: SimulationResult["series"] = [];

  let cosineReachedRound: number | null = null;
  let cosineMaxValue = -1;
  let cosineMaxRound = 0;
  let convergenceReason: string | null = null;
  let convergenceRound: number | null = null;
  let totalRounds = 0;

  for (let round = 1; round <= config.absoluteMaxRounds; round++) {
    const pair = selectPair(model, properties, stats, usedPairs, commuteById);
    const pairKey = [pair.a.id, pair.b.id].sort().join("-");
    usedPairs.add(pairKey);

    const featA = toFeatureVector(pair.a, stats, commuteById.get(pair.a.id));
    const featB = toFeatureVector(pair.b, stats, commuteById.get(pair.b.id));

    const scoreA = dot(hiddenW, featA);
    const scoreB = dot(hiddenW, featB);
    const winner = scoreA >= scoreB ? pair.a : pair.b;
    const loser = scoreA >= scoreB ? pair.b : pair.a;

    model = updateModel(
      model,
      toFeatureVector(winner, stats, commuteById.get(winner.id)),
      toFeatureVector(loser, stats, commuteById.get(loser.id)),
    );

    const metrics = computeRoundMetrics(
      model, properties, stats, round, topKHistory, commuteById,
    );

    const currentTopK = properties
      .map((p) => ({ id: p.id, s: scoreProperty(model, toFeatureVector(p, stats, commuteById.get(p.id))) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
      .map((x) => x.id);
    topKHistory = [...topKHistory, currentTopK];

    const meanW = getMeanWeight(model);
    const cos = cosineSimilarity(meanW, hiddenW);

    series.push({ ...metrics, cosineToHidden: cos });

    if (cos > cosineMaxValue) {
      cosineMaxValue = cos;
      cosineMaxRound = round;
    }

    if (cosineReachedRound == null && cos >= config.hiddenMatchCosine) {
      cosineReachedRound = round;
    }

    const isTopKStable = topKHistory.length >= 3 && (() => {
      const recent = topKHistory.slice(-3);
      return recent.every((r) => r.join(",") === recent[0].join(","));
    })();

    const isEvrLow = metrics.evr < 0.01;
    const isConcHigh = metrics.concentration >= 0.95;

    if (round >= config.minRounds) {
      if (isTopKStable && !convergenceReason) {
        convergenceReason = "Top-K 안정화";
        convergenceRound = round;
      } else if (isEvrLow && !convergenceReason) {
        convergenceReason = "EVR 임계값 도달";
        convergenceRound = round;
      } else if (isConcHigh && !convergenceReason) {
        convergenceReason = "사후분포 집중도 ≥ 0.95";
        convergenceRound = round;
      }
    }

    totalRounds = round;

    if (convergenceRound != null && cosineReachedRound != null) {
      break;
    }

    if (!config.silent && round % 100 === 0) {
      process.stdout.write(
        `  round ${round}: cos=${cos.toFixed(4)} evr=${metrics.evr.toFixed(4)} conc=${metrics.concentration.toFixed(4)} topK=${metrics.topKStability.toFixed(2)}\n`,
      );
    }
  }

  return {
    meta: {
      candidateCount: properties.length,
      minRounds: config.minRounds,
      absoluteMaxRounds: config.absoluteMaxRounds,
      hiddenMatchCosine: config.hiddenMatchCosine,
      hiddenWeights: hiddenW,
      initialPrior,
      totalRounds,
      cosineReachedRound,
      cosineMaxValue,
      cosineMaxRound,
      convergenceReason,
      convergenceRound,
    },
    series,
  };
}
