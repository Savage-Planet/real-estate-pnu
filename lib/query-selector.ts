import type { Property } from "@/types";
import type { RewardModel } from "./reward-model";
import { type FeatureVector, type FeatureStats, toFeatureVector } from "./feature-engineer";
import { haversine } from "./geo";

const MIN_DISTANCE_M = 50;

export interface PropertyPair {
  a: Property;
  b: Property;
  expectedVolumeRemoval: number;
}

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

function computeExpectedVolumeRemoval(
  phi: FeatureVector,
  samples: FeatureVector[],
): number {
  let sumPos = 0;
  let sumNeg = 0;

  for (const w of samples) {
    const s = dot(w, phi);
    sumPos += 1 - sigmoid(s);
    sumNeg += 1 - sigmoid(-s);
  }

  const ePos = sumPos / samples.length;
  const eNeg = sumNeg / samples.length;

  return Math.min(ePos, eNeg);
}

const MAX_CANDIDATES = 100;

export function selectPair(
  model: RewardModel,
  candidates: Property[],
  stats: FeatureStats,
  usedPairs?: Set<string>,
): PropertyPair {
  const featureCache = new Map<string, FeatureVector>();
  const getFeatures = (p: Property): FeatureVector => {
    if (!featureCache.has(p.id)) {
      featureCache.set(p.id, toFeatureVector(p, stats));
    }
    return featureCache.get(p.id)!;
  };

  let pool = candidates;
  if (pool.length > MAX_CANDIDATES) {
    pool = [...pool].sort(() => Math.random() - 0.5).slice(0, MAX_CANDIDATES);
  }

  let bestPair: PropertyPair | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];

      if (haversine(a.lat, a.lng, b.lat, b.lng) < MIN_DISTANCE_M) continue;

      const pairKey = [a.id, b.id].sort().join("-");
      if (usedPairs?.has(pairKey)) continue;

      const phiA = getFeatures(a);
      const phiB = getFeatures(b);
      const phi = phiA.map((v, k) => v - phiB[k]);

      const evr = computeExpectedVolumeRemoval(phi, model.samples);

      if (evr > bestScore) {
        bestScore = evr;
        bestPair = { a, b, expectedVolumeRemoval: evr };
      }
    }
  }

  if (!bestPair) {
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const a = shuffled[0];
    const b = shuffled.find((p) => p.id !== a.id && haversine(a.lat, a.lng, p.lat, p.lng) >= MIN_DISTANCE_M) ?? shuffled[1];
    bestPair = { a, b, expectedVolumeRemoval: 0 };
  }

  return bestPair;
}

export function getMaxExpectedVolumeRemoval(
  model: RewardModel,
  candidates: Property[],
  stats: FeatureStats,
): number {
  const pair = selectPair(model, candidates, stats);
  return pair.expectedVolumeRemoval;
}
