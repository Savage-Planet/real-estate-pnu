# 경사도(Slope) 계산 방법

## 1. 개요

본 프로젝트에서 경사도는 **두 가지 목적**으로 활용됩니다.

| 목적 | 사용 위치 | 설명 |
|------|-----------|------|
| **모델 특징벡터** | `lib/feature-engineer.ts` | 매물의 `walk_slope_avg` 값을 0–1 사이로 정규화해 선호도 학습에 사용 |
| **지도 시각화** | `lib/elevation.ts` + `app/compare/page.tsx` | 도보 경로를 경사도에 따라 색상별 폴리라인으로 지도에 표시 |

---

## 2. 고도 데이터 출처

```
opentopodata.org  →  SRTM 90m 격자 DEM
```

- **SRTM (Shuttle Radar Topography Mission)**: NASA 우주왕복선이 2000년에 수집한 레이더 고도 데이터
- **해상도**: 90m × 90m 격자 (1 포인트 = 약 90m 범위 평균 고도)
- **접근 방식**: `api.opentopodata.org/v1/srtm90m?locations=lat,lng|lat,lng|...` (GET, 무료, 1 req/s)
- **Next.js 프록시**: CORS 우회를 위해 `app/api/elevation/route.ts`가 서버에서 중계

```
브라우저 → POST /api/elevation → opentopodata.org → SRTM 고도값 반환
```

---

## 3. 지도 시각화 파이프라인

### 3-1. 도보 경로 포인트 수집

Kakao 도보 경로 API(`calcWalkRoute`)가 반환한 경로 좌표 배열을 사용합니다.  
경로는 두 세그먼트로 나뉩니다:

```
매물 → 부산대 정문 (propertyToGateRoute)
부산대 정문 → 건물 (gateToBuildingRoute)
```

### 3-2. 포인트 샘플링 (`samplePoints`)

고도 API는 요청당 최대 100 포인트, 속도 제한 1 req/s이므로  
각 세그먼트에서 **최대 16개 포인트**를 균등 간격으로 추출합니다.

```typescript
// lib/elevation.ts
function samplePoints(points: LatLngPoint[], maxSamples = 24): LatLngPoint[] {
  const step = points.length / maxSamples;
  for (let i = 0; i < maxSamples; i++) {
    result.push(points[Math.round(i * step)]);
  }
  // 마지막 포인트 항상 포함 (경로 끝점 누락 방지)
}
```

두 세그먼트를 **하나의 배열로 합쳐** API를 단 1회 호출합니다 (rate-limit 방지):

```typescript
// app/compare/page.tsx
const sampled1 = samplePoints(seg1, 16);   // 매물→정문
const sampled2 = samplePoints(seg2, 16);   // 정문→건물
const combined = [...sampled1, ...sampled2];

// 단일 API 호출
const { elevations } = await fetch("/api/elevation", {
  body: JSON.stringify({ locations: combined }),
});

// 분리 후 각각 경사도 계산
calcSlopePolylines(sampled1, elevations.slice(0, sampled1.length));
calcSlopePolylines(sampled2, elevations.slice(sampled1.length));
```

### 3-3. 경사도 계산 (`calcSlopePolylines`)

인접한 두 포인트 쌍에 대해:

1. **수직 고도 차** (Δh):
   ```
   Δh = elevation[i+1] − elevation[i]   (단위: m)
   ```

2. **수평 거리** (Δd) — Haversine 공식:
   ```
   Δd = 2R · arcsin(√(sin²(ΔΦ/2) + cos(Φ₁)·cos(Φ₂)·sin²(Δλ/2)))
   R = 6,371,000 m
   ```

3. **경사도** (단위: %):
   ```
   slope(%) = |Δh| / Δd × 100
   ```
   > 방향(오르막/내리막)은 색상 분류에서 절댓값으로 처리 (`Math.abs(Δh)`)

### 3-4. 색상 분류 (5단계)

| 경사도 범위 | 색상 | 의미 |
|------------|------|------|
| 0 – 3% | `#22c55e` 초록 | 평탄 |
| 3 – 7% | `#84cc16` 라임 | 완만 |
| 7 – 12% | `#eab308` 노랑 | 보통 |
| 12 – 18% | `#f97316` 주황 | 가파름 |
| 18%+ | `#ef4444` 빨강 | 매우 가파름 |

같은 색상이 연속되면 폴리라인을 **병합**해 렌더링 비용을 줄입니다.

---

## 4. 모델 특징벡터 (walk_slope_avg)

### 4-1. DB 컬럼

`properties.walk_slope_avg` (real): 해당 매물에서 부산대 정문까지 도보 경로의 **평균 경사도(%)**.  
현재는 예약 컬럼으로 수동 또는 스크립트로 백필 예정.

### 4-2. 정규화 (`slopeFeatureValue`)

```typescript
// lib/feature-engineer.ts
function slopeFeatureValue(slope: number | null | undefined): number {
  if (slope == null) return 0.5;          // 미백필 → 중립값
  const clamped = Math.min(Math.max(slope, 0), 20);  // 0~20% 범위로 클램핑
  return 1 - clamped / 20;               // 완만할수록 높은 값 (1에 가까움)
}
```

| `walk_slope_avg` | 특징값 | 의미 |
|-----------------|--------|------|
| 0% (평탄) | 1.0 | 선호도 최대 |
| 10% | 0.5 | 중립 |
| 20% (가파름) | 0.0 | 선호도 최소 |
| null (미백필) | 0.5 | 중립 처리 |

특징벡터 20차원 중 **19번째 차원 (idx 18)**에 배치되며, `distance` 카테고리 그룹에 속합니다.

---

## 5. 한계 및 유의사항

| 항목 | 내용 |
|------|------|
| **해상도** | SRTM 90m 격자 → 좁은 골목이나 계단은 반영 안 됨 |
| **샘플링 오차** | 경로 16개 포인트 → 짧은 경사 구간 누락 가능 |
| **고도 정확도** | SRTM 90m 수직 정확도 ±16m (평균 ±9m) |
| **walk_slope_avg** | 현재 DB 백필 안 된 매물은 0.5 중립값 사용 |
| **오르막/내리막 구분** | 특징벡터에서는 절댓값만 사용 (방향 무시) |
