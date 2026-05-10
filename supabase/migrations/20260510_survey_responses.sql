-- ============================================================
-- 20260510_survey_responses.sql
-- 모델 체험 후 설문 응답 저장 테이블
-- Supabase SQL Editor 에서 실행
-- ============================================================

CREATE TABLE IF NOT EXISTS survey_responses (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id             text,            -- compare 세션 ID (results 페이지에서 전달)
  created_at             timestamptz DEFAULT now(),

  -- Q1-Q4 인구통계
  gender                 text,            -- '남성' | '여성'
  age_group              text,            -- '10대' | '20대' | '30대' | '40대 이상'
  housing_type           text,            -- '원룸·투룸' | '오피스텔' | '아파트' | '기숙사' | '기타'
  floor_level            text,            -- '반지하' | '1층' | '2~3층' | '4층 이상'

  -- Q5-Q6 안전 인식
  safety_importance      smallint CHECK (safety_importance BETWEEN 1 AND 5),
  had_crime_anxiety      boolean,
  anxiety_reasons        text[],          -- Q6-1 복수 선택 (had_crime_anxiety=true 일 때)

  -- Q7-Q11 변수 타당성 인식
  age_bug_belief         smallint CHECK (age_bug_belief BETWEEN 1 AND 5),
  restaurant_bug_belief  smallint CHECK (restaurant_bug_belief BETWEEN 1 AND 5),
  streetlight_safety     smallint CHECK (streetlight_safety BETWEEN 1 AND 5),
  cctv_usefulness        smallint CHECK (cctv_usefulness BETWEEN 1 AND 5),
  noise_usefulness       smallint CHECK (noise_usefulness BETWEEN 1 AND 5),

  -- Q12-Q14 시스템 평가 (모델 체험 후)
  accuracy_rating        smallint CHECK (accuracy_rating BETWEEN 1 AND 5),
  personalization_rating smallint CHECK (personalization_rating BETWEEN 1 AND 5),
  novelty_rating         smallint CHECK (novelty_rating BETWEEN 1 AND 5)
);

-- Row Level Security
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

-- anon 사용자: 삽입 허용
CREATE POLICY "anon_insert_survey" ON survey_responses
  FOR INSERT TO anon WITH CHECK (true);

-- anon 사용자: 전체 조회 허용 (집계 분석 목적)
CREATE POLICY "anon_select_survey" ON survey_responses
  FOR SELECT TO anon USING (true);
