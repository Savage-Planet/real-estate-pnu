"""
scripts/import-cctv-locations.py
==================================
CCTV_수집(c1-c79).xlsx → Supabase cctv_locations 테이블 삽입

소스 컬럼: 번호, 이름, 위도 (Latitude), 경도 (Longitude)
총 79개 CCTV 위치

사전 조건: supabase/migrations/20260505_new_features.sql 을 먼저 실행할 것
실행: python scripts/import-cctv-locations.py
"""

import sys, io, os, openpyxl
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import requests

SUPABASE_URL = "https://myioidtlkuenxhmmtjll.supabase.co"
SERVICE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15aW9pZHRsa3VlbnhobW10amxsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTI0Njg2MywiZXhwIjoyMDkwODIyODYzfQ.ak3HweaqxY1N4LKFFBeKI5Q49jLu3CwPY5L0lQjhSd0"

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


def find_xlsx() -> str:
    """카카오톡 받은 파일 폴더에서 CCTV xlsx 찾기"""
    base = r"C:\Users\PC\Documents"
    for fname in os.listdir(base):
        folder = os.path.join(base, fname)
        if not os.path.isdir(folder):
            continue
        try:
            for f in os.listdir(folder):
                if "CCTV" in f and "수집" in f and f.endswith(".xlsx"):
                    return os.path.join(folder, f)
        except PermissionError:
            pass
    # 이름이 깨진 경우도 처리
    for fname in os.listdir(base):
        folder = os.path.join(base, fname)
        if not os.path.isdir(folder):
            continue
        try:
            for f in os.listdir(folder):
                if "CCTV" in f and f.endswith(".xlsx"):
                    return os.path.join(folder, f)
        except PermissionError:
            pass
    raise FileNotFoundError("CCTV xlsx 파일을 찾을 수 없습니다.")


def check_schema():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/cctv_locations?select=id&limit=1",
        headers=HEADERS,
    )
    if r.status_code == 404:
        print("❌ cctv_locations 테이블이 없습니다.")
        print("   먼저 Supabase SQL Editor에서 다음 파일을 실행하세요:")
        print("   supabase/migrations/20260505_new_features.sql")
        sys.exit(1)
    print("✅ 스키마 확인 완료")


def main():
    check_schema()

    xlsx_path = find_xlsx()
    print(f"소스 파일: {xlsx_path}")

    wb = openpyxl.load_workbook(xlsx_path)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    header = [str(h).strip() if h else "" for h in rows[0]]
    print(f"헤더: {header}")
    print(f"총 {len(rows)-1}개 CCTV 위치 처리 예정\n")

    # 컬럼 인덱스
    def col(keyword):
        for i, h in enumerate(header):
            if keyword.lower() in h.lower():
                return i
        raise ValueError(f"'{keyword}' 컬럼을 찾을 수 없음. 헤더: {header}")

    lat_idx  = col("위도")
    lng_idx  = col("경도")
    name_idx = col("이름")

    # 기존 데이터 전체 삭제 후 재삽입
    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/cctv_locations?id=gt.0",
        headers=HEADERS,
    )
    print(f"기존 데이터 삭제: {r.status_code}")

    records = []
    for row in rows[1:]:
        lat  = row[lat_idx]
        lng  = row[lng_idx]
        name = row[name_idx]
        if lat is None or lng is None:
            continue
        records.append({
            "lat":           float(lat),
            "lng":           float(lng),
            "location_type": str(name) if name else None,
        })

    # 한 번에 일괄 삽입
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/cctv_locations",
        json=records,
        headers=HEADERS,
    )
    if r.status_code in (200, 201, 204):
        print(f"✅ {len(records)}개 CCTV 위치 삽입 완료")
    else:
        print(f"❌ 삽입 실패: {r.status_code}: {r.text[:300]}")


if __name__ == "__main__":
    main()
