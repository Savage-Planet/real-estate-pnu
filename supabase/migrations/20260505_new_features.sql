-- ============================================================
-- 20260505_new_features.sql
-- 신규 기능: 편의시설, CCTV 위치, 보안/층수/엘베, 벌레지수, 경사도
-- Supabase SQL Editor 에서 실행
-- ============================================================

-- 1. properties 테이블 신규 컬럼 --------------------------------
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS floor_number       smallint,
  ADD COLUMN IF NOT EXISTS total_floors       smallint,
  ADD COLUMN IF NOT EXISTS has_intercom       boolean,
  ADD COLUMN IF NOT EXISTS has_security_guard boolean,
  ADD COLUMN IF NOT EXISTS has_card_key       boolean,
  ADD COLUMN IF NOT EXISTS bug_risk           text,    -- '상' | '중' | '하'
  ADD COLUMN IF NOT EXISTS walk_slope_avg     real;    -- 경사도 평균(%) - 후속 작업용 예약

-- 2. CCTV 위치 테이블 ------------------------------------------
CREATE TABLE IF NOT EXISTS cctv_locations (
  id            serial PRIMARY KEY,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  location_type text    -- '건물 외벽', '로봇식' 등 (수집 원본 그대로)
);

-- 3. 편의시설 테이블 --------------------------------------------
CREATE TABLE IF NOT EXISTS amenities (
  id      text PRIMARY KEY,               -- Kakao place_id
  type    text NOT NULL,                  -- 'convenience_store' | 'gym' | 'olive_young' |
                                          --  'coin_laundry' | 'hospital' | 'pharmacy' | 'bank'
  name    text NOT NULL,
  lat     double precision NOT NULL,
  lng     double precision NOT NULL,
  address text
);
