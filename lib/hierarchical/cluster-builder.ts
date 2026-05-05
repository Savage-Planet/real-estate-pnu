/**
 * cluster-builder.ts
 * ==================
 * K-Means++ 군집화 + 실루엣 계수로 최적 K 선택 + 군집 라벨 자동 생성
 *
 * 참고:
 *   MacQueen (1967) - K-Means
 *   Rousseeuw (1987) J. Computational Applied Mathematics - 실루엣 계수
 */

import type { Property } from "@/types";
import type { FeatureVector, FeatureStats, CommuteFeatures } from "../feature-engineer";
import { toFeatureVector, FEATURE_DIM, FEATURE_NAMES } from "../feature-engineer";

// ──────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────

export interface ClusterResult {
  clusterId: number;
  label: string;
  centroid: FeatureVector;
  /** centroid와 유클리드 거리가 가장 가까운 실제 매물 ID */
  representativePropertyId: string;
  memberIds: string[];
  size: number;
}

export interface ClusterBuildOutput {
  k: number;
  silhouetteScore: number;
  clusters: ClusterResult[];
  buildTimestamp: string;
}

// ──────────────────────────────────────────────────────────
// LCG 시드 기반 pseudo-random (재현성)
// ──────────────────────────────────────────────────────────

class SeededRandom {
  private state: number;
  constructor(seed = 42) { this.state = seed >>> 0; }

  next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  nextInt(n: number): number { return Math.floor(this.next() * n); }
}

// ──────────────────────────────────────────────────────────
// 유클리드 거리 제곱
// ──────────────────────────────────────────────────────────

function sqDist(a: FeatureVector, b: FeatureVector): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return s;
}

function dist(a: FeatureVector, b: FeatureVector): number {
  return Math.sqrt(sqDist(a, b));
}

// ──────────────────────────────────────────────────────────
// K-Means++ 초기화
// ──────────────────────────────────────────────────────────

function kmeansppInit(data: FeatureVector[], k: number, rng: SeededRandom): FeatureVector[] {
  const n = data.length;
  const centroids: FeatureVector[] = [];
  centroids.push([...data[rng.nextInt(n)]]);

  for (let ci = 1; ci < k; ci++) {
    const dists = data.map((pt) => Math.min(...centroids.map((c) => sqDist(pt, c))));
    const total = dists.reduce((a, b) => a + b, 0);
    let threshold = rng.next() * total;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) {
      threshold -= dists[i];
      if (threshold <= 0) { chosen = i; break; }
    }
    centroids.push([...data[chosen]]);
  }
  return centroids;
}

// ──────────────────────────────────────────────────────────
// K-Means 단일 실행
// ──────────────────────────────────────────────────────────

function kmeans(
  data: FeatureVector[],
  k: number,
  rng: SeededRandom,
  maxIter = 100,
  tol = 1e-6,
): { labels: number[]; centroids: FeatureVector[] } {
  const n = data.length;
  const dim = data[0].length;
  let centroids = kmeansppInit(data, k, rng);
  let labels = new Array<number>(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // 할당
    const newLabels = data.map((pt) => {
      let minD = Infinity, best = 0;
      for (let ci = 0; ci < k; ci++) {
        const d = sqDist(pt, centroids[ci]);
        if (d < minD) { minD = d; best = ci; }
      }
      return best;
    });

    // centroid 업데이트
    const sums: number[][] = Array.from({ length: k }, () => new Array(dim).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = newLabels[i];
      counts[c]++;
      for (let d = 0; d < dim; d++) sums[c][d] += data[i][d];
    }

    let maxMove = 0;
    const newCentroids: FeatureVector[] = centroids.map((old, ci) => {
      if (counts[ci] === 0) return [...old];
      const nc = sums[ci].map((s) => s / counts[ci]);
      maxMove = Math.max(maxMove, dist(old, nc));
      return nc;
    });

    labels = newLabels;
    centroids = newCentroids;
    if (maxMove < tol) break;
  }

  return { labels, centroids };
}

// ──────────────────────────────────────────────────────────
// 실루엣 계수 (Rousseeuw 1987)
// ──────────────────────────────────────────────────────────

function silhouetteScore(data: FeatureVector[], labels: number[], k: number): number {
  const n = data.length;
  let total = 0;
  let valid = 0;

  // 군집별 인덱스 캐시
  const byCluster: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) byCluster[labels[i]].push(i);

  for (let i = 0; i < n; i++) {
    const ci = labels[i];
    const sameCluster = byCluster[ci];
    if (sameCluster.length <= 1) continue;

    // a: 같은 군집 내 평균 거리
    let aSum = 0;
    for (const j of sameCluster) {
      if (j !== i) aSum += dist(data[i], data[j]);
    }
    const a = aSum / (sameCluster.length - 1);

    // b: 가장 가까운 다른 군집까지 평균 거리
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === ci) continue;
      const otherCluster = byCluster[c];
      if (otherCluster.length === 0) continue;
      let bSum = 0;
      for (const j of otherCluster) bSum += dist(data[i], data[j]);
      const bAvg = bSum / otherCluster.length;
      if (bAvg < b) b = bAvg;
    }

    const s = (b - a) / Math.max(a, b);
    total += s;
    valid++;
  }

  return valid === 0 ? 0 : total / valid;
}

// ──────────────────────────────────────────────────────────
// 군집 라벨 자동 생성
// ──────────────────────────────────────────────────────────

/** dim 인덱스 → 사람이 읽기 쉬운 라벨용 축약어 */
const LABEL_DIMS: Array<{ idx: number; name: string; highGood: boolean }> = [
  { idx: 0,  name: "월세",   highGood: false },  // 낮을수록 좋음
  { idx: 13, name: "거리",   highGood: false },  // feature는 짧을수록 높음 → highGood=true지만 label 반전
  { idx: 12, name: "소음",   highGood: false },
  { idx: 3,  name: "크기",   highGood: true },
];

function generateLabel(centroid: FeatureVector, globalMean: FeatureVector): string {
  const parts: string[] = [];
  for (const { idx, name, highGood } of LABEL_DIMS) {
    const v = centroid[idx];
    const m = globalMean[idx];
    const diff = v - m;
    if (Math.abs(diff) < 0.08) continue;  // 차이가 작으면 라벨 생략
    if (name === "거리") {
      // 통학거리: feature높음=가까움(좋음), feature낮음=멀음
      parts.push(diff > 0 ? "근거리" : "원거리");
    } else if (name === "소음") {
      parts.push(diff < 0 ? "저소음" : "고소음");
    } else {
      const isGood = highGood ? diff > 0 : diff < 0;
      parts.push(isGood ? `저${name}` : `고${name}`);
    }
    if (parts.length >= 2) break;
  }
  return parts.length > 0 ? parts.join("·") + "형" : `군집${centroid[0].toFixed(1)}`;
}

// ──────────────────────────────────────────────────────────
// 대표 매물 선정 (centroid와 유클리드 거리 최소)
// ──────────────────────────────────────────────────────────

function findRepresentative(
  memberIds: string[],
  featureMap: Map<string, FeatureVector>,
  centroid: FeatureVector,
): string {
  let best = memberIds[0];
  let bestD = Infinity;
  for (const id of memberIds) {
    const fv = featureMap.get(id);
    if (!fv) continue;
    const d = sqDist(fv, centroid);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

// ──────────────────────────────────────────────────────────
// 메인 빌드 함수
// ──────────────────────────────────────────────────────────

export interface BuildClustersOptions {
  kMin?: number;       // default 3
  kMax?: number;       // default 8
  seed?: number;       // default 42
  verbose?: boolean;
}

export function buildClusters(
  properties: Property[],
  stats: FeatureStats,
  commuteById: Map<string, CommuteFeatures>,
  options: BuildClustersOptions = {},
): ClusterBuildOutput {
  const { kMin = 3, kMax = 8, seed = 42, verbose = false } = options;

  // 특징 벡터 계산
  const ids = properties.map((p) => p.id);
  const featureMap = new Map<string, FeatureVector>();
  const data: FeatureVector[] = properties.map((p) => {
    const fv = toFeatureVector(p, stats, commuteById.get(p.id));
    featureMap.set(p.id, fv);
    return fv;
  });

  // 전체 평균 (라벨 생성용)
  const dim = FEATURE_DIM;
  const globalMean: FeatureVector = new Array(dim).fill(0);
  for (const fv of data) for (let d = 0; d < dim; d++) globalMean[d] += fv[d];
  for (let d = 0; d < dim; d++) globalMean[d] /= data.length;

  // K별 실루엣 계수 계산
  let bestK = kMin;
  let bestSilhouette = -Infinity;
  let bestLabels: number[] = [];
  let bestCentroids: FeatureVector[] = [];

  for (let k = kMin; k <= kMax; k++) {
    const rng = new SeededRandom(seed);
    const { labels, centroids } = kmeans(data, k, rng);
    const sil = silhouetteScore(data, labels, k);
    if (verbose) process.stdout.write(`  K=${k}: silhouette=${sil.toFixed(4)}\n`);
    if (sil > bestSilhouette) {
      bestSilhouette = sil;
      bestK = k;
      bestLabels = labels;
      bestCentroids = centroids;
    }
  }

  if (verbose) process.stdout.write(`  → 최적 K=${bestK} (silhouette=${bestSilhouette.toFixed(4)})\n`);

  // 군집별 멤버 수집
  const membersByCluster: string[][] = Array.from({ length: bestK }, () => []);
  for (let i = 0; i < ids.length; i++) membersByCluster[bestLabels[i]].push(ids[i]);

  // ClusterResult 조립
  const clusters: ClusterResult[] = bestCentroids.map((centroid, ci) => {
    const memberIds = membersByCluster[ci];
    return {
      clusterId: ci,
      label: generateLabel(centroid, globalMean),
      centroid,
      representativePropertyId: findRepresentative(memberIds, featureMap, centroid),
      memberIds,
      size: memberIds.length,
    };
  });

  return {
    k: bestK,
    silhouetteScore: bestSilhouette,
    clusters,
    buildTimestamp: new Date().toISOString(),
  };
}
