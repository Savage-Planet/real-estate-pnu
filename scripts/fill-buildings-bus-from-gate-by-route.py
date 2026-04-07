#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
from pathlib import Path

import requests


def load_local_env() -> None:
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


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p = math.pi / 180.0
    a = (
        0.5
        - math.cos((lat2 - lat1) * p) / 2
        + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    )
    return r * 2 * math.asin(math.sqrt(a))


# User-provided route points (1..10), 1 is PNU gate stop.
ROUTE_POINTS = [
    (35.231705, 129.084510),
    (35.232814, 129.083527),
    (35.234200, 129.082359),
    (35.235125, 129.081636),
    (35.235798, 129.080080),
    (35.236234, 129.078706),
    (35.233339, 129.077899),
    (35.232223, 129.077300),
    (35.232679, 129.076344),
    (35.233686, 129.075749),
]

MIN_PER_STOP = 1.8


def nearest_route_index(lat: float, lng: float) -> tuple[int, float]:
    best_idx = 1
    best_dist = float("inf")
    for i, (rlat, rlng) in enumerate(ROUTE_POINTS, start=1):
        d = haversine_m(lat, lng, rlat, rlng)
        if d < best_dist:
            best_dist = d
            best_idx = i
    return best_idx, best_dist


def main() -> int:
    load_local_env()
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        return 1

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    select_url = (
        f"{url}/rest/v1/buildings"
        "?select=id,name,lat,lng,bus_from_gate_min"
        "&bus_from_gate_min=is.null"
        "&limit=10000"
        "&order=name"
    )
    resp = requests.get(select_url, headers=headers, timeout=30)
    resp.raise_for_status()
    rows = resp.json()

    updated = 0
    for b in rows:
        bid = b["id"]
        name = b.get("name", str(bid))
        lat = float(b["lat"])
        lng = float(b["lng"])
        idx, dist_m = nearest_route_index(lat, lng)
        minutes = round((idx - 1) * MIN_PER_STOP, 1)

        payload = {
            "bus_from_gate_min": minutes,
            "bus_from_gate_transfers": 0,
            "bus_from_gate_info": {
                "status": "ROUTE_INDEX_ESTIMATE",
                "method": "nearest_of_10_route_points",
                "nearest_route_index": idx,
                "nearest_distance_m": round(dist_m, 1),
                "minutes_per_stop": MIN_PER_STOP,
                "estimated_min": minutes,
            },
        }
        patch_url = f"{url}/rest/v1/buildings?id=eq.{bid}"
        u = requests.patch(patch_url, headers=headers, data=json.dumps(payload), timeout=30)
        u.raise_for_status()
        updated += 1
        print(f"[OK] {name}: idx={idx}, min={minutes}, dist={round(dist_m,1)}m")

    print(f"done: updated {updated} buildings (bus_from_gate_min was null)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
