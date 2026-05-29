-- ─────────────────────────────────────────────────────────────────────────────
-- Admin approval + session logging
-- 1) agent_properties.approved : 관리자 승인 전에는 학습/추천에서 제외 (허위매물 필터)
-- 2) user_sessions : 사용자 세션 진행 로그 (시작/이탈 라운드/완료)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. 승인 컬럼 ──────────────────────────────────────────────────────────────
ALTER TABLE public.agent_properties
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;

-- 공개 조회 정책을 승인+활성 기준으로 교체
DROP POLICY IF EXISTS "agent_properties_public_read" ON public.agent_properties;
CREATE POLICY "agent_properties_public_read"
  ON public.agent_properties FOR SELECT
  USING (is_active = true AND approved = true);

-- ── 2. user_sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_sessions (
  session_id        text PRIMARY KEY,
  status            text NOT NULL DEFAULT 'started',  -- 'started' | 'completed'
  building_id       text,
  -- 진행 상황
  phase             text,            -- 'macro' | 'micro' | 'extra' | 'done'
  macro_round       int DEFAULT 0,
  micro_round       int DEFAULT 0,
  extra_round       int DEFAULT 0,
  last_round        int DEFAULT 0,   -- 전체 비교 횟수(이탈 지점 추정)
  did_extra         boolean DEFAULT false,
  selected_category text,
  started_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  completed_at      timestamptz
);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- 익명 사용자가 자신의 세션을 기록/갱신/조회할 수 있도록 허용
DROP POLICY IF EXISTS "user_sessions_insert_anon" ON public.user_sessions;
CREATE POLICY "user_sessions_insert_anon"
  ON public.user_sessions FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "user_sessions_update_anon" ON public.user_sessions;
CREATE POLICY "user_sessions_update_anon"
  ON public.user_sessions FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "user_sessions_select_anon" ON public.user_sessions;
CREATE POLICY "user_sessions_select_anon"
  ON public.user_sessions FOR SELECT
  USING (true);
