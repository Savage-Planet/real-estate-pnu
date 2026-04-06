# 비교(`/compare`) 화면 디버깅

## 콘솔 로그

1. 브라우저에서 **F12 → Console**
2. 필터 입력란에 `compare` 또는 `[compare]` 를 넣으면 `lib/compare-log.ts`에서 찍는 로그만 볼 수 있습니다.

단계별로 다음이 출력될 수 있습니다.

| 접두/문구 | 의미 |
|-----------|------|
| `init 완료` | 매물·통계·모델 준비 완료 |
| `computeStatsWithCommute` | 초기 통학 통계( DB 도보 ) 실패 |
| `buildings` / `properties` | Supabase 건물·매물 쿼리 오류 |
| `enrichPair 시작` / `setPair 완료` | 페어 한 쌍에 대한 경로·가로등 처리 |
| `calcTransitForDisplay` | 도보/ODsay 경로 단계에서 오류 또는 타임아웃 |
| `loadStreetLights` / `filterLightsAlongRoute` | 가로등 조회·필터 오류 |
| `selectPair` | 다음 비교 페어 고르기 실패 |

## Network 탭

- **Supabase** (`*.supabase.co`): `buildings`, `properties`, `building_gate_routes`, `street_lights`
- **ODsay** (`api.odsay.com`): 도보 18분 이상일 때만 `searchPubTransPathT`

요청이 **Pending**으로 오래 남으면 해당 API가 느리거나 막힌 것입니다.

## 화면에 뜨는 메시지

- **초기화 오류**: `computeStatsWithCommute` 등으로 모델을 못 만든 경우
- **건물 정보 없음**: `building` 쿼리스트링이 잘못되었거나 건물 행이 없음
- **페어 로딩 참고**(노란 박스): 경로/가로등 중 일부만 실패했을 수 있음. 비교는 이어질 수 있음

## 타임아웃

`enrichPair` 안에서 도보/버스 경로는 약 **60초**, 가로등 목록은 약 **45초**를 넘기면 에러로 처리하고 콘솔에 남깁니다.
