"""
scripts/fetch-amenities.py
===========================
Kakao Local Search API → Supabase amenities 테이블 삽입

검색 대상 7종 (부산대 정문 반경 1500m):
  convenience_store  - 편의점  (category CS2)
  hospital           - 병원    (category HP8)
  pharmacy           - 약국    (category PM9)
  bank               - 은행    (category BK9)
  gym                - 헬스장  (keyword)
  olive_young        - 올리브영 (keyword)
  coin_laundry       - 코인세탁소 (keyword)

사전 조건:
  1. supabase/migrations/20260505_new_features.sql 을 먼저 실행할 것
  2. .env.local 에 KAKAO_REST_API_KEY=<REST API 키> 추가
     (Kakao 개발자 콘솔 → 앱 → 앱 키 → REST API 키)

실행: python scripts/fetch-amenities.py
"""

import sys, io, os, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import requests

SUPABASE_URL = "https://myioidtlkuenxhmmtjll.supabase.co"
SERVICE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15aW9pZHRsa3VlbnhobW10amxsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTI0Njg2MywiZXhwIjoyMDkwODIyODYzfQ.ak3HweaqxY1N4LKFFBeKI5Q49jLu3CwPY5L0lQjhSd0"

SUPABASE_HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",  # upsert
}

# 부산대 정문 좌표 (경도, 위도 순서 - Kakao API는 x=경도, y=위도)
PNU_LNG = 129.0840
PNU_LAT = 35.2316
RADIUS_M = 3000

# Kakao REST API 키 (.env.local 또는 환경변수에서 로드)
def load_kakao_key() -> str:
    # 1순위: 환경변수
    key = os.environ.get("KAKAO_REST_API_KEY", "")
    if key:
        return key

    # 2순위: .env.local 파일에서 파싱
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    env_path = os.path.normpath(env_path)
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("KAKAO_REST_API_KEY="):
                    return line.split("=", 1)[1].strip()

    return ""


SEARCH_TARGETS = [
    # (type, 검색방식, 값)
    ("convenience_store", "category", "CS2"),
    ("hospital",          "category", "HP8"),
    ("pharmacy",          "category", "PM9"),
    ("bank",              "category", "BK9"),
    ("gym",               "keyword",  "헬스장"),
    ("olive_young",       "keyword",  "올리브영"),
    ("coin_laundry",      "keyword",  "코인세탁소"),
]


def kakao_search_category(rest_key: str, category_code: str) -> list[dict]:
    """Kakao 카테고리 검색 (페이징 포함)"""
    results = []
    page = 1
    while True:
        r = requests.get(
            "https://dapi.kakao.com/v2/local/search/category.json",
            params={
                "category_group_code": category_code,
                "x": PNU_LNG,
                "y": PNU_LAT,
                "radius": RADIUS_M,
                "page": page,
                "size": 15,
            },
            headers={"Authorization": f"KakaoAK {rest_key}"},
        )
        if r.status_code != 200:
            print(f"    ❌ 카카오 API 오류 {r.status_code}: {r.text[:200]}")
            break
        data = r.json()
        results.extend(data.get("documents", []))
        meta = data.get("meta", {})
        if meta.get("is_end", True):
            break
        page += 1
        time.sleep(0.1)
    return results


def kakao_search_keyword(rest_key: str, keyword: str) -> list[dict]:
    """Kakao 키워드 검색 (페이징 포함)"""
    results = []
    page = 1
    while True:
        r = requests.get(
            "https://dapi.kakao.com/v2/local/search/keyword.json",
            params={
                "query": keyword,
                "x": PNU_LNG,
                "y": PNU_LAT,
                "radius": RADIUS_M,
                "page": page,
                "size": 15,
            },
            headers={"Authorization": f"KakaoAK {rest_key}"},
        )
        if r.status_code != 200:
            print(f"    ❌ 카카오 API 오류 {r.status_code}: {r.text[:200]}")
            break
        data = r.json()
        results.extend(data.get("documents", []))
        meta = data.get("meta", {})
        if meta.get("is_end", True):
            break
        page += 1
        time.sleep(0.1)
    return results


def check_schema():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/amenities?select=id&limit=1",
        headers=SUPABASE_HEADERS,
    )
    if r.status_code == 404:
        print("❌ amenities 테이블이 없습니다.")
        print("   먼저 Supabase SQL Editor에서 다음 파일을 실행하세요:")
        print("   supabase/migrations/20260505_new_features.sql")
        sys.exit(1)
    print("✅ 스키마 확인 완료")


def main():
    check_schema()

    rest_key = load_kakao_key()
    if not rest_key:
        print("❌ KAKAO_REST_API_KEY 가 없습니다.")
        print("   Kakao 개발자 콘솔(developers.kakao.com)에서 REST API 키를 확인 후")
        print("   .env.local 에 KAKAO_REST_API_KEY=<키> 를 추가하세요.")
        print("   (NEXT_PUBLIC_KAKAO_MAP_KEY 는 JavaScript 앱 키라 REST API에 사용 불가)")
        sys.exit(1)

    print(f"Kakao REST API 키: {rest_key[:8]}...")
    print(f"검색 중심: 위도={PNU_LAT}, 경도={PNU_LNG}, 반경={RADIUS_M}m\n")

    all_records: list[dict] = []

    for (amenity_type, method, value) in SEARCH_TARGETS:
        print(f"[{amenity_type}] 검색 중 ({method}={value}) ...")
        if method == "category":
            docs = kakao_search_category(rest_key, value)
        else:
            docs = kakao_search_keyword(rest_key, value)

        for doc in docs:
            all_records.append({
                "id":      doc["id"],
                "type":    amenity_type,
                "name":    doc.get("place_name", ""),
                "lat":     float(doc.get("y", 0)),
                "lng":     float(doc.get("x", 0)),
                "address": doc.get("road_address_name") or doc.get("address_name", ""),
            })

        print(f"  → {len(docs)}개 수집")
        time.sleep(0.2)

    print(f"\n총 {len(all_records)}개 편의시설 수집 완료")
    print("Supabase에 upsert 중...")

    # 100개씩 청크 업서트
    chunk_size = 100
    ok = 0
    for i in range(0, len(all_records), chunk_size):
        chunk = all_records[i:i + chunk_size]
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/amenities",
            json=chunk,
            headers=SUPABASE_HEADERS,
        )
        if r.status_code in (200, 201, 204):
            ok += len(chunk)
        else:
            print(f"  ❌ 청크 {i}~{i+len(chunk)} 실패: {r.status_code}: {r.text[:200]}")

    print(f"\n완료: {ok}/{len(all_records)}개 upsert 성공")

    # 타입별 요약
    from collections import Counter
    counter = Counter(r["type"] for r in all_records)
    print("\n타입별 수집 수:")
    for t, cnt in sorted(counter.items()):
        print(f"  {t}: {cnt}개")


if __name__ == "__main__":
    main()
