# 편의시설(Amenities) 데이터 수집 및 활용

## 1. 개요

사용자가 선택한 편의시설 유형별로 **각 매물에서 가장 가까운 시설의 직선거리**를 계산하여,
비교 지도에 표시하고 추천 점수에 반영합니다.

---

## 2. 수집 대상 (7종)

| 타입 키 | 이름 | 아이콘 | Kakao API 검색 방식 | 검색값 |
|---------|------|--------|---------------------|--------|
| `convenience_store` | 편의점 | 🏪 | 카테고리 검색 | `CS2` |
| `hospital` | 병원 | 🏥 | 카테고리 검색 | `HP8` |
| `pharmacy` | 약국 | 💉 | 카테고리 검색 | `PM9` |
| `bank` | 은행 | 🏦 | 카테고리 검색 | `BK9` |
| `gym` | 헬스장 | 💪 | 키워드 검색 | `"헬스장"` |
| `olive_young` | 올리브영 | 💊 | 키워드 검색 | `"올리브영"` |
| `coin_laundry` | 코인세탁 | 🫧 | 키워드 검색 | `"코인세탁소"` |

> 편의점·병원·약국·은행은 Kakao 공식 카테고리 코드로 정확하게 검색하고,
> 헬스장·올리브영·코인세탁소는 카테고리 코드가 없어 키워드로 검색합니다.

---

## 3. 수집 스크립트 (`scripts/fetch-amenities.py`)

### 3-1. 수집 중심 좌표 및 반경

```
중심 좌표: 부산대학교 정문 (위도 35.2316, 경도 129.0840)
반경: 3,000 m
```

> 초기에는 1,500 m로 설정했으나, 부산대 정문에서 멀리 떨어진 매물(장전동 북부 등)을
> 커버하기 위해 **3,000 m로 확장**했습니다.

### 3-2. API 호출 방식

**카테고리 검색** (`/v2/local/search/category.json`)
```
GET https://dapi.kakao.com/v2/local/search/category.json
  ?category_group_code=CS2
  &x=129.0840   (경도)
  &y=35.2316    (위도)
  &radius=3000
  &page=1&size=15
```

**키워드 검색** (`/v2/local/search/keyword.json`)
```
GET https://dapi.kakao.com/v2/local/search/keyword.json
  ?query=헬스장
  &x=129.0840
  &y=35.2316
  &radius=3000
  &page=1&size=15
```

- 두 방식 모두 **페이지네이션 자동 처리**: `meta.is_end == false`이면 `page++` 반복
- 호출 간격: 카테고리당 0.2초, 페이지당 0.1초 (rate-limit 준수)

### 3-3. 수집 필드

| Supabase 컬럼 | Kakao 응답 필드 | 설명 |
|--------------|----------------|------|
| `id` | `id` | Kakao place_id (PK, 중복 방지) |
| `type` | — | 위 7종 타입 키 |
| `name` | `place_name` | 시설 이름 |
| `lat` | `y` | 위도 |
| `lng` | `x` | 경도 |
| `address` | `road_address_name` 또는 `address_name` | 도로명 주소 우선 |

### 3-4. Supabase 저장

- 100개씩 청크 분할 후 **upsert** (`Prefer: resolution=merge-duplicates`)
- 동일 `id`(Kakao place_id)가 있으면 덮어씌워 중복 방지
- 테이블: `amenities` (RLS: anon 공개 읽기 허용)

---

## 4. DB 스키마

```sql
-- supabase/migrations/20260505_new_features.sql
CREATE TABLE IF NOT EXISTS amenities (
  id      text PRIMARY KEY,        -- Kakao place_id
  type    text NOT NULL,           -- 'convenience_store' | 'gym' | ...
  name    text NOT NULL,
  lat     double precision NOT NULL,
  lng     double precision NOT NULL,
  address text
);

ALTER TABLE amenities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "amenities_public_read"
  ON amenities FOR SELECT TO public USING (true);
```

---

## 5. 최근접 거리 계산 (`lib/amenities.ts`)

### 5-1. 알고리즘

각 매물에 대해 **타입별로 가장 가까운 시설 1개**를 선택합니다.

```typescript
// 타입별 그룹핑 후, 각 매물 × 각 타입 → 최솟값 탐색
for (const [type, list] of byType.entries()) {
  let minDist = Infinity;
  for (const amenity of list) {
    const d = haversine(property.lat, property.lng, amenity.lat, amenity.lng);
    if (d < minDist) { minDist = d; best = amenity; }
  }
}
```

- **거리 계산**: Haversine 공식 (구면 직선거리, 단위: m)
- **결과 정렬**: 거리 오름차순 (가장 가까운 타입부터)

### 5-2. 표시 예시

사용자가 "편의점, 약국" 선택 → 각 매물 카드 위 버튼:

```
🏪 편의점  GS25 장전점  145m
💉 약국    온천약국     312m
```

버튼 클릭 시 해당 시설 위치에 지도 마커 표시.

---

## 6. 추천 점수 반영 (`app/results/page.tsx`)

### 6-1. 근접도 점수 (`calcAmenityProximityScore`)

```typescript
const MAX_DIST_M = 1_200;  // 1.2km 이상이면 점수 0

// 타입별 점수 = max(0, 1 - 거리/1200)
// 전체 점수 = 타입별 점수 평균
```

| 거리 | 점수 |
|------|------|
| 0 m (바로 옆) | 1.0 |
| 600 m | 0.5 |
| 1,200 m | 0.0 |
| 1,200 m 초과 | 0.0 |

### 6-2. 최종 점수 합산

```typescript
const AMENITY_WEIGHT = 0.15;  // 편의시설 15% 반영

finalScore = modelScore × 0.85 + amenityScore × 0.15
```

> 편의시설 선택이 없으면(amenityTypes 미설정) 기존 모델 점수만 사용합니다.

---

## 7. 사용자 인터페이스

| 위치 | 기능 |
|------|------|
| `/filter` 페이지 | 7종 중 **복수 선택** 가능 (선택 안 해도 됨) |
| `/compare` 매물 카드 위 | 선택된 타입별 최근접 시설 이름 + 거리 버튼 |
| `/compare` 지도 | 버튼 클릭 시 해당 시설 위치 마커 표시 |
| `/results` 페이지 | 편의시설 근접도 15% 반영된 최종 순위 |

---

## 8. 한계 및 유의사항

| 항목 | 내용 |
|------|------|
| **직선거리** | 실제 도보 경로가 아닌 Haversine 직선거리 사용 |
| **수집 범위** | 부산대 정문 중심 3km → 해운대·서면 등 먼 지역 미수록 |
| **키워드 검색** | 헬스장·올리브영·코인세탁소는 누락/오분류 가능성 있음 |
| **갱신 주기** | 스크립트 재실행 전까지 폐업·이전 반영 안 됨 |
| **최대 1.2km** | 점수 산정 상한이 1.2km → 그 이상은 모두 0점 처리 |
