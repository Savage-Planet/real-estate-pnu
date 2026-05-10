-- ============================================================
-- 20260510_amenities_rls.sql
-- amenities 테이블 공개 읽기 허용 (RLS 정책)
-- Supabase SQL Editor 에서 실행
-- ============================================================

-- RLS 활성화
ALTER TABLE amenities ENABLE ROW LEVEL SECURITY;

-- 누구나 읽기 허용 (편의시설은 공개 데이터)
-- PostgreSQL은 CREATE POLICY IF NOT EXISTS 미지원 → DO 블록으로 처리
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'amenities' AND policyname = 'amenities_public_read'
  ) THEN
    EXECUTE 'CREATE POLICY "amenities_public_read" ON amenities FOR SELECT TO public USING (true)';
  END IF;
END $$;

-- cctv_locations 도 동일하게
ALTER TABLE cctv_locations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cctv_locations' AND policyname = 'cctv_public_read'
  ) THEN
    EXECUTE 'CREATE POLICY "cctv_public_read" ON cctv_locations FOR SELECT TO public USING (true)';
  END IF;
END $$;
