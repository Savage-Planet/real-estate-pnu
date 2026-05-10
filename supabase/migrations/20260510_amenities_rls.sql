-- ============================================================
-- 20260510_amenities_rls.sql
-- amenities 테이블 공개 읽기 허용 (RLS 정책)
-- Supabase SQL Editor 에서 실행
-- ============================================================

-- RLS 활성화
ALTER TABLE amenities ENABLE ROW LEVEL SECURITY;

-- 누구나 읽기 허용 (편의시설은 공개 데이터)
CREATE POLICY IF NOT EXISTS "amenities_public_read"
  ON amenities
  FOR SELECT
  TO public
  USING (true);

-- cctv_locations 도 동일하게
ALTER TABLE cctv_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "cctv_public_read"
  ON cctv_locations
  FOR SELECT
  TO public
  USING (true);
