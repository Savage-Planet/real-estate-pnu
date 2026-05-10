/**
 * elevation.ts
 * ============
 * 도보 경로 경사도 시각화 유틸리티
 *
 * Open Elevation API(SRTM 90m 격자)를 통해 경로 포인트의 고도를 조회한 뒤
 * 인접 포인트 간 경사도(%)를 계산하여 색상이 지정된 폴리라인 세그먼트로 변환한다.
 *
 * 경사도 → 색상 매핑 (5단계):
 *   0 – 3%  : #22c55e (초록)   — 평탄
 *   3 – 7%  : #84cc16 (라임)   — 약간 경사
 *   7 – 12% : #eab308 (노랑)   — 보통 경사
 *   12 – 18%: #f97316 (주황)   — 가파름
 *   18%+    : #ef4444 (빨강)   — 매우 가파름
 */

import type { KakaoMapPolyline } from "@/components/KakaoMap";

export interface LatLngPoint {
  lat: number;
  lng: number;
}

// ──────────────────────────────────────────────────────────
// 색상 매핑
// ──────────────────────────────────────────────────────────

export const SLOPE_LEVELS = [
  { maxPct: 3,  color: "#22c55e", label: "평탄 (0-3%)" },
  { maxPct: 7,  color: "#84cc16", label: "완만 (3-7%)" },
  { maxPct: 12, color: "#eab308", label: "보통 (7-12%)" },
  { maxPct: 18, color: "#f97316", label: "가파름 (12-18%)" },
  { maxPct: Infinity, color: "#ef4444", label: "매우 가파름 (18%+)" },
] as const;

export function slopeToColor(slopePct: number): string {
  const abs = Math.abs(slopePct);
  for (const level of SLOPE_LEVELS) {
    if (abs < level.maxPct) return level.color;
  }
  return "#ef4444";
}

// ──────────────────────────────────────────────────────────
// 수평 거리 계산 (간단한 Haversine 단순화)
// ──────────────────────────────────────────────────────────

function horizDistM(a: LatLngPoint, b: LatLngPoint): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ──────────────────────────────────────────────────────────
// 포인트 샘플링 (API 호출 최소화: 최대 maxSamples 개)
// ──────────────────────────────────────────────────────────

export function samplePoints(points: LatLngPoint[], maxSamples = 24): LatLngPoint[] {
  if (points.length <= maxSamples) return points;
  const step = points.length / maxSamples;
  const result: LatLngPoint[] = [];
  for (let i = 0; i < maxSamples; i++) {
    result.push(points[Math.round(i * step)]);
  }
  // 마지막 포인트는 항상 포함
  const last = points[points.length - 1];
  if (result[result.length - 1] !== last) result.push(last);
  return result;
}

// ──────────────────────────────────────────────────────────
// 고도 조회 (Next.js API 프록시 경유)
// ──────────────────────────────────────────────────────────

export async function fetchRouteElevations(points: LatLngPoint[]): Promise<number[]> {
  const sampled = samplePoints(points);
  const res = await fetch("/api/elevation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locations: sampled }),
  });
  if (!res.ok) throw new Error(`elevation api ${res.status}`);
  const { elevations } = (await res.json()) as { elevations: number[] };
  if (!elevations || elevations.length !== sampled.length) {
    throw new Error("elevation count mismatch");
  }
  return elevations;
}

// ──────────────────────────────────────────────────────────
// 경사도 계산 → 색상 폴리라인 배열 변환
// ──────────────────────────────────────────────────────────

/**
 * 샘플된 경로 포인트와 그에 대응하는 고도 배열을 받아
 * 인접 포인트 쌍을 경사도로 색상 분류한 `KakaoMapPolyline[]`을 반환한다.
 *
 * 인접 색상이 같은 세그먼트는 병합하여 폴리라인 수를 최소화한다.
 */
export function calcSlopePolylines(
  points: LatLngPoint[],
  elevations: number[],
  weight = 5,
): KakaoMapPolyline[] {
  if (points.length < 2 || elevations.length < 2) return [];

  const n = Math.min(points.length, elevations.length);
  const segments: Array<{ pts: LatLngPoint[]; color: string }> = [];

  let currentColor = "";
  let currentPts: LatLngPoint[] = [];

  for (let i = 0; i < n - 1; i++) {
    const dElev = elevations[i + 1] - elevations[i];
    const dHoriz = horizDistM(points[i], points[i + 1]);
    const slopePct = dHoriz > 0 ? (Math.abs(dElev) / dHoriz) * 100 : 0;
    const color = slopeToColor(slopePct);

    if (color !== currentColor) {
      if (currentPts.length >= 2) segments.push({ pts: currentPts, color: currentColor });
      currentColor = color;
      currentPts = [points[i]];
    }
    currentPts.push(points[i + 1]);
  }
  if (currentPts.length >= 2) segments.push({ pts: currentPts, color: currentColor });

  return segments.map(({ pts, color }) => ({
    path: pts,
    color,
    weight,
    opacity: 0.9,
  }));
}
