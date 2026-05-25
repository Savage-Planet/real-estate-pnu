"""
scripts/import-security-floor.py
=================================
엘베 + 보안.xlsx → Supabase properties 테이블 업데이트

컬럼 매핑:
  층정보       → floor_number, total_floors
  현관보안     → has_entrance_security
  CCTV         → has_cctv
  인터폰 OR 비디오폰 → has_intercom
  경비원       → has_security_guard
  카드키       → has_card_key
  기타시설     → has_elevator ('엘리베이터' 포함 여부)

사전 조건: supabase/migrations/20260505_new_features.sql 을 먼저 실행할 것
실행: python scripts/import-security-floor.py
"""

import sys, io, math, os, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import openpyxl
import requests

SUPABASE_URL = "https://myioidtlkuenxhmmtjll.supabase.co"
SERVICE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15aW9pZHRsa3VlbnhobW10amxsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTI0Njg2MywiZXhwIjoyMDkwODIyODYzfQ.ak3HweaqxY1N4LKFFBeKI5Q49jLu3CwPY5L0lQjhSd0"

XLSX_PATH = r"C:\Users\PC\Desktop\종프\엘베 + 보안.xlsx"

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


def parse_floor(raw: str | None) -> tuple[int | None, int | None]:
    """
    "6/9"  → (6, 9)
    "저/7" → (round(7*0.25), 7) = (2, 7)
    "중/7" → (round(7*0.50), 7) = (4, 7)  ← 3.5 올림
    "고/7" → (round(7*0.75), 7) = (5, 7)
    파싱 불가 → (None, None)
    """
    if not raw:
        return None, None
    raw = str(raw).strip()
    if "/" not in raw:
        return None, None
    left, right = raw.split("/", 1)
    left, right = left.strip(), right.strip()
    try:
        total = int(right)
    except ValueError:
        return None, None
    ratio_map = {"저": 0.25, "중": 0.50, "고": 0.75}
    if left in ratio_map:
        floor = math.ceil(total * ratio_map[left])
    else:
        try:
            floor = int(left)
        except ValueError:
            return None, None
    return floor, total


def check_schema():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/properties?select=floor_number,has_intercom,has_security_guard,has_card_key&limit=1",
        headers=HEADERS,
    )
    if r.status_code == 400 and "does not exist" in r.text:
        print("❌ 신규 컬럼이 없습니다.")
        print("   먼저 Supabase SQL Editor에서 다음 파일을 실행하세요:")
        print("   supabase/migrations/20260505_new_features.sql")
        sys.exit(1)
    print("✅ 스키마 확인 완료")


def main():
    check_schema()

    wb = openpyxl.load_workbook(XLSX_PATH)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    header = [str(h).strip() if h else "" for h in rows[0]]
    print(f"헤더: {header}")
    print(f"총 {len(rows)-1}행 처리 예정\n")

    # 컬럼 인덱스 찾기
    def col(name):
        for i, h in enumerate(header):
            if name in h:
                return i
        raise ValueError(f"컬럼 '{name}' 을 찾을 수 없음. 헤더: {header}")

    idx_id        = col("id")
    idx_floor     = col("층정보")
    idx_entrance  = col("현관보안")
    idx_cctv      = col("CCTV")
    idx_interphone = col("인터폰")
    idx_video     = col("비디오폰")
    idx_guard     = col("경비원")
    idx_card      = col("카드키")
    idx_other     = col("기타시설")

    ok = err = skip = 0

    for row in rows[1:]:
        prop_id = str(row[idx_id]).strip() if row[idx_id] is not None else ""
        if not prop_id:
            skip += 1
            continue

        floor_num, total_fl = parse_floor(row[idx_floor])

        has_intercom = bool(row[idx_interphone]) or bool(row[idx_video])

        other = str(row[idx_other]) if row[idx_other] else ""
        has_elevator = "엘리베이터" in other

        payload = {
            "floor_number":       floor_num,
            "total_floors":       total_fl,
            "has_entrance_security": bool(row[idx_entrance]),
            "has_cctv":           bool(row[idx_cctv]),
            "has_intercom":       has_intercom,
            "has_security_guard": bool(row[idx_guard]),
            "has_card_key":       bool(row[idx_card]),
            "has_elevator":       has_elevator,
        }

        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/properties?id=eq.{prop_id}",
            json=payload,
            headers=HEADERS,
        )
        if r.status_code in (200, 204):
            ok += 1
        else:
            print(f"  ❌ id={prop_id} → {r.status_code}: {r.text[:120]}")
            err += 1

        if (ok + err) % 50 == 0:
            print(f"  진행: {ok+err}/{len(rows)-1} (ok={ok}, err={err})")

    print(f"\n완료: ok={ok}, err={err}, skip={skip}")


if __name__ == "__main__":
    main()
