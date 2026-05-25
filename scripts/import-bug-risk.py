"""
scripts/import-bug-risk.py
===========================
벌레척도 스코어링.csv → Supabase properties.bug_risk 업데이트

컬럼: id, 벌레발생가능성 ('상' | '중' | '하')

사전 조건: supabase/migrations/20260505_new_features.sql 을 먼저 실행할 것
실행: python scripts/import-bug-risk.py
"""

import sys, io, csv
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import requests

SUPABASE_URL = "https://myioidtlkuenxhmmtjll.supabase.co"
SERVICE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15aW9pZHRsa3VlbnhobW10amxsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTI0Njg2MywiZXhwIjoyMDkwODIyODYzfQ.ak3HweaqxY1N4LKFFBeKI5Q49jLu3CwPY5L0lQjhSd0"

CSV_PATH = r"C:\Users\PC\Desktop\종프\벌레척도 스코어링.csv"

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

VALID_VALUES = {"상", "중", "하"}


def check_schema():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/properties?select=bug_risk&limit=1",
        headers=HEADERS,
    )
    if r.status_code == 400 and "does not exist" in r.text:
        print("❌ bug_risk 컬럼이 없습니다.")
        print("   먼저 Supabase SQL Editor에서 다음 파일을 실행하세요:")
        print("   supabase/migrations/20260505_new_features.sql")
        sys.exit(1)
    print("✅ 스키마 확인 완료")


def main():
    check_schema()

    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        rows = list(reader)

    header = rows[0]
    print(f"헤더: {header}")
    print(f"총 {len(rows)-1}행 처리 예정\n")

    # 컬럼 인덱스
    id_idx   = header.index("id")
    risk_idx = next(i for i, h in enumerate(header) if "벌레" in h)

    ok = err = skip = 0

    for row in rows[1:]:
        if len(row) <= max(id_idx, risk_idx):
            skip += 1
            continue

        prop_id   = str(row[id_idx]).strip()
        bug_risk  = str(row[risk_idx]).strip()

        if not prop_id:
            skip += 1
            continue

        if bug_risk not in VALID_VALUES:
            print(f"  ⚠️  id={prop_id}: 예상치 못한 값 '{bug_risk}' → skip")
            skip += 1
            continue

        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/properties?id=eq.{prop_id}",
            json={"bug_risk": bug_risk},
            headers=HEADERS,
        )
        if r.status_code in (200, 204):
            ok += 1
        else:
            print(f"  ❌ id={prop_id} → {r.status_code}: {r.text[:120]}")
            err += 1

        if (ok + err) % 100 == 0:
            print(f"  진행: {ok+err}/{len(rows)-1} (ok={ok}, err={err})")

    print(f"\n완료: ok={ok}, err={err}, skip={skip}")


if __name__ == "__main__":
    main()
