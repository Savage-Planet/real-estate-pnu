#!/usr/bin/env python3
from __future__ import annotations

import json
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

    sel = f"{url}/rest/v1/properties?select=id,bus_to_gate_min,bus_to_gate_info&limit=10000&order=id"
    rows = requests.get(sel, headers=headers, timeout=30)
    rows.raise_for_status()
    data = rows.json()

    fixed_total = 0
    fixed_error = 0
    for row in data:
        rid = row.get("id")
        info = row.get("bus_to_gate_info")
        new_min = None
        new_transfers = None

        if isinstance(info, dict):
            if "total_time_min" in info:
                try:
                    new_min = float(info.get("total_time_min") or 0)
                    new_transfers = int(info.get("transit_count") or 0)
                    fixed_total += 1
                except Exception:
                    pass

            status = str(info.get("status") or "")
            reason = str(info.get("reason") or "")
            if status == "NO_ROUTE_OR_API_ERROR" or "ApiKeyAuthFailed" in reason:
                new_min = 0
                new_transfers = 0
                fixed_error += 1

        if new_min is None:
            continue

        patch_url = f"{url}/rest/v1/properties?id=eq.{rid}"
        payload = {
            "bus_to_gate_min": new_min,
            "bus_to_gate_transfers": new_transfers if new_transfers is not None else 0,
        }
        r = requests.patch(patch_url, headers=headers, data=json.dumps(payload), timeout=30)
        r.raise_for_status()

    print(f"done: total_time_min 복구 {fixed_total}건, 오류 0처리 {fixed_error}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
