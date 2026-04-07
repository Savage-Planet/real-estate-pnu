#!/usr/bin/env python3
"""
ODsay로 매물→부산대 정문, 정문→건물 버스 경로를 Supabase에 백필합니다.
학습용 전처리이므로 거리 예외 없이 전 건을 ODsay 호출합니다.

필수 환경변수:
  SUPABASE_URL (또는 NEXT_PUBLIC_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY

ODsay 호출:
  Next 개발 서버 프록시 사용 (브라우저와 동일 키 경로).
  1) 다른 터미널에서: npm run dev
  2) ODSAY_PROXY_URL=http://localhost:3000 (기본값)

선택:
  PNU_GATE_LAT, PNU_GATE_LNG (기본: 부산대 정문)
  DELAY_SEC (기본 0.35)
  BACKFILL_SECRET (.env.local에 있으면 요청 헤더에 자동 포함)
"""

from __future__ import annotations

import math
import os
import sys
import time
from pathlib import Path

import requests

def load_local_env() -> None:
    """
    Load .env.local in repo root for script execution convenience.
    Existing process env values take precedence.
    """
    env_path = Path(__file__).resolve().parents[1] / ".env.local"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        k = k.strip()
        v = v.strip().strip("'").strip('"')
        if k and k not in os.environ:
            os.environ[k] = v


load_local_env()

ODSAY_PROXY_URL = os.environ.get("ODSAY_PROXY_URL", "http://localhost:3000").rstrip("/")
BACKFILL_SECRET = os.environ.get("BACKFILL_SECRET", "")
SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
).rstrip("/")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("SUPABASE_KEY")
    or ""
)

PNU_GATE_LAT = float(os.environ.get("PNU_GATE_LAT", "35.231654"))
PNU_GATE_LNG = float(os.environ.get("PNU_GATE_LNG", "129.084588"))
DELAY = float(os.environ.get("DELAY_SEC", "0.35"))
RETRY_DELAYS = [0.8, 1.5]


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    p = math.pi / 180.0
    a = (
        0.5
        - math.cos((lat2 - lat1) * p) / 2
        + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    )
    return R * 2 * math.asin(math.sqrt(a))


def _proxy_headers() -> dict:
    h = {"Content-Type": "application/json"}
    if BACKFILL_SECRET:
        h["X-Backfill-Secret"] = BACKFILL_SECRET
    return h


def odsay_transit_via_next(
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
) -> tuple[dict | None, str | None]:
    """Next 프록시(/api/odsay)로 ODsay 호출 — 브라우저와 동일한 서버 경로."""
    url = f"{ODSAY_PROXY_URL}/api/odsay"
    payload = {"sx": start_lng, "sy": start_lat, "ex": end_lng, "ey": end_lat}
    for attempt in range(len(RETRY_DELAYS) + 1):
        try:
            resp = requests.post(url, json=payload, headers=_proxy_headers(), timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if data.get("ok") is True and data.get("data"):
                return data["data"], None
            reason = data.get("reason", "proxy_failed")
            return None, str(reason)
        except Exception as e:
            if attempt >= len(RETRY_DELAYS):
                return None, f"proxy_error:{e}"
            time.sleep(RETRY_DELAYS[attempt])
    return None, "unknown"


def preflight_next_proxy() -> tuple[bool, str | None]:
    """Next 서버가 떠 있고 ODsay 프록시가 동작하는지 확인."""
    ok, reason = odsay_transit_via_next(
        PNU_GATE_LAT,
        PNU_GATE_LNG,
        PNU_GATE_LAT + 0.01,
        PNU_GATE_LNG + 0.01,
    )
    if ok:
        return True, None
    return False, reason or "preflight_failed"


def supabase_select(table: str, select: str = "*", filters: str = "", limit: int = 1000) -> list:
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept": "application/json",
    }
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={select}&limit={limit}"
    if filters:
        url += f"&{filters}"
    resp = requests.get(url, headers=headers)
    resp.raise_for_status()
    return resp.json()


def supabase_update(table: str, match_col: str, match_val: str, data: dict) -> requests.Response:
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    from urllib.parse import quote

    q = quote(str(match_val), safe="")
    url = f"{SUPABASE_URL}/rest/v1/{table}?{match_col}=eq.{q}"
    return requests.patch(url, headers=headers, json=data)


def main() -> int:
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)")
    if not SUPABASE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if missing:
        print("Missing required env: " + ", ".join(missing), file=sys.stderr)
        return 1
    if SUPABASE_KEY.startswith("sb_publishable_"):
        print(
            "오류: NEXT_PUBLIC_SUPABASE_ANON_KEY(sb_publishable_)로는 UPDATE가 막힙니다.\n"
            "SUPABASE_SERVICE_ROLE_KEY를 설정한 뒤 다시 실행하세요.",
            file=sys.stderr,
        )
        return 1
    ok, reason = preflight_next_proxy()
    if not ok:
        print(
            "Next ODsay 프록시 실패. DB 업데이트를 하지 않습니다.\n"
            "다른 터미널에서 `npm run dev` 후 다시 시도하세요.\n"
            f"Reason: {reason}",
            file=sys.stderr,
        )
        return 1

    print("=" * 60)
    print("  매물 → 부산대 정문 버스 경로 수집")
    print("=" * 60)
    properties = supabase_select(
        "properties",
        select="id,lat,lng,straight_dist_to_gate",
        filters="order=id",
    )
    print(f"수집 대상: {len(properties)}건\n")
    success = fail = 0
    for i, prop in enumerate(properties):
        pid = prop["id"]
        plat, plng = prop["lat"], prop["lng"]
        straight_dist = prop.get("straight_dist_to_gate")
        dist_label = f"{round(straight_dist)}m" if straight_dist is not None else "n/a"
        print(f"[{i+1}/{len(properties)}] {pid} (직선 {dist_label}) ...", end=" ", flush=True)
        actual_dist = haversine(plat, plng, PNU_GATE_LAT, PNU_GATE_LNG)
        result, err_reason = odsay_transit_via_next(plat, plng, PNU_GATE_LAT, PNU_GATE_LNG)
        if result:
            update_data = {
                "bus_to_gate_min": result["total_time_min"],
                "bus_to_gate_transfers": result["transit_count"],
                "bus_to_gate_info": result,
            }
            resp = supabase_update("properties", "id", pid, update_data)
            if resp.status_code < 300:
                print(f"✓ {result['total_time_min']}분 (환승{result['transit_count']}회) {result['summary']}")
                success += 1
            else:
                print(f"✗ DB: {resp.status_code}")
                fail += 1
        else:
            update_data = {
                "bus_to_gate_min": 0,
                "bus_to_gate_transfers": 0,
                "bus_to_gate_info": {
                    "status": "NO_ROUTE_OR_API_ERROR",
                    "reason": err_reason,
                    "distance_m": round(actual_dist),
                },
            }
            resp = supabase_update("properties", "id", pid, update_data)
            print(f"△ 경로 미확정(null 저장): {err_reason} ({round(actual_dist)}m)")
            success += 1 if resp.status_code < 300 else 0
            if resp.status_code >= 300:
                fail += 1
        time.sleep(DELAY)
    print(f"\n매물 완료: 성공 {success}, 실패 {fail}\n")

    print("=" * 60)
    print("  부산대 정문 → 각 건물 버스 경로 수집")
    print("=" * 60)
    buildings = supabase_select(
        "buildings",
        select="id,name,lat,lng",
        filters="order=name",
    )
    print(f"수집 대상: {len(buildings)}건\n")
    success_b = fail_b = 0
    for i, bld in enumerate(buildings):
        bid = bld["id"]
        bname = bld["name"]
        blat, blng = bld["lat"], bld["lng"]
        dist = haversine(PNU_GATE_LAT, PNU_GATE_LNG, blat, blng)
        print(f"[{i+1}/{len(buildings)}] {bname} (직선 {round(dist)}m) ...", end=" ", flush=True)
        result, err_reason = odsay_transit_via_next(PNU_GATE_LAT, PNU_GATE_LNG, blat, blng)
        if result:
            update_data = {
                "bus_from_gate_min": result["total_time_min"],
                "bus_from_gate_transfers": result["transit_count"],
                "bus_from_gate_info": result,
            }
            resp = supabase_update("buildings", "id", bid, update_data)
            if resp.status_code < 300:
                print(f"✓ {result['total_time_min']}분 {result['summary']}")
                success_b += 1
            else:
                print(f"✗ DB: {resp.status_code}")
                fail_b += 1
        else:
            update_data = {
                "bus_from_gate_min": 0,
                "bus_from_gate_transfers": 0,
                "bus_from_gate_info": {
                    "status": "NO_ROUTE_OR_API_ERROR",
                    "reason": err_reason,
                    "distance_m": round(dist),
                },
            }
            resp = supabase_update("buildings", "id", bid, update_data)
            print(f"△ 경로 미확정(null 저장): {err_reason} ({round(dist)}m)")
            success_b += 1 if resp.status_code < 300 else 0
            if resp.status_code >= 300:
                fail_b += 1
        time.sleep(DELAY)
    print(f"\n건물 완료: 성공 {success_b}, 실패 {fail_b}")
    print("\n학습 시 버스 특징: bus_to_gate_min + bus_from_gate_min (분)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
