-- ============================================================
-- 버스 경로 컬럼 (properties + buildings)
-- Supabase SQL Editor에서 실행 후 scripts/fetch-bus-routes-odsay.py 로 백필
-- ============================================================

ALTER TABLE properties ADD COLUMN IF NOT EXISTS bus_to_gate_min FLOAT8;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS bus_to_gate_transfers INTEGER;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS bus_to_gate_info JSONB;

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS bus_from_gate_min FLOAT8;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS bus_from_gate_transfers INTEGER;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS bus_from_gate_info JSONB;
