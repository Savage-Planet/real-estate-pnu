-- ─────────────────────────────────────────────────────────────────────────────
-- Agent System migration
-- Tables: agent_profiles, agent_properties, property_interactions
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. agent_profiles ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    text UNIQUE NOT NULL,
  phone       text NOT NULL,
  office_address text NOT NULL,
  office_lat  float8,
  office_lng  float8,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.agent_profiles ENABLE ROW LEVEL SECURITY;

-- 본인만 자신의 프로필 조회/수정 가능
CREATE POLICY "agent_profiles_select_own"
  ON public.agent_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "agent_profiles_insert_own"
  ON public.agent_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "agent_profiles_update_own"
  ON public.agent_profiles FOR UPDATE
  USING (auth.uid() = id);

-- 앱 내 모든 사용자가 전화번호/위치를 볼 수 있도록 공개 select 허용 (results 페이지용)
CREATE POLICY "agent_profiles_public_read"
  ON public.agent_profiles FOR SELECT
  USING (true);

-- ── 2. agent_properties ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_properties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES public.agent_profiles(id) ON DELETE CASCADE,

  -- 위치
  address         text NOT NULL,
  lat             float8 NOT NULL,
  lng             float8 NOT NULL,

  -- 기본 정보
  trade_type      text NOT NULL DEFAULT '월세',   -- '월세' | '전세'
  property_type   text NOT NULL DEFAULT '원룸',
  rooms           int  NOT NULL DEFAULT 1,
  parking         int  NOT NULL DEFAULT 0,
  direction       text NOT NULL DEFAULT '',

  -- 가격
  monthly_rent    int  NOT NULL DEFAULT 0,
  deposit         int  NOT NULL DEFAULT 0,
  exclusive_area  float8 NOT NULL DEFAULT 0,
  maintenance_fee int  NOT NULL DEFAULT 0,

  -- 시설
  has_elevator          boolean DEFAULT false,
  has_closet            boolean DEFAULT false,
  has_builtin_closet    boolean DEFAULT false,
  has_entrance_security boolean DEFAULT false,

  -- 년식 (within_4y=true면 나머지는 모두 true)
  within_4y   boolean DEFAULT false,
  within_10y  boolean DEFAULT false,
  within_15y  boolean DEFAULT false,
  within_25y  boolean DEFAULT false,

  -- 사진
  photo_urls  text[] DEFAULT '{}',

  -- 백필 후 채워지는 필드들
  nearest_gate          text,
  walk_to_gate_min      float8,
  walk_to_gate_m        float8,
  walk_to_gate_route    jsonb,
  bus_to_gate_min       float8,
  bus_to_gate_transfers int,
  noise_level           float8,

  -- 활성 여부 (비활성 = 결과에서 숨김)
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.agent_properties ENABLE ROW LEVEL SECURITY;

-- 누구나 활성 매물 조회 가능
CREATE POLICY "agent_properties_public_read"
  ON public.agent_properties FOR SELECT
  USING (is_active = true);

-- 본인 매물은 비활성도 조회 가능
CREATE POLICY "agent_properties_own_read"
  ON public.agent_properties FOR SELECT
  USING (auth.uid() = agent_id);

-- 본인만 등록/수정/삭제
CREATE POLICY "agent_properties_insert_own"
  ON public.agent_properties FOR INSERT
  WITH CHECK (auth.uid() = agent_id);

CREATE POLICY "agent_properties_update_own"
  ON public.agent_properties FOR UPDATE
  USING (auth.uid() = agent_id);

CREATE POLICY "agent_properties_delete_own"
  ON public.agent_properties FOR DELETE
  USING (auth.uid() = agent_id);

-- ── 3. property_interactions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_interactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_property_id   uuid NOT NULL REFERENCES public.agent_properties(id) ON DELETE CASCADE,
  session_id          text NOT NULL,
  viewed_at           timestamptz DEFAULT now(),
  liked               boolean,           -- null = 미응답
  requested_phone     boolean,           -- null = 미응답
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE public.property_interactions ENABLE ROW LEVEL SECURITY;

-- 누구나 삽입 가능 (익명 사용자 추적용)
CREATE POLICY "interactions_insert_anon"
  ON public.property_interactions FOR INSERT
  WITH CHECK (true);

-- 본인 매물의 인터랙션 통계는 중개인이 조회 가능
CREATE POLICY "interactions_select_agent"
  ON public.property_interactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.agent_properties ap
      WHERE ap.id = agent_property_id AND ap.agent_id = auth.uid()
    )
  );

-- 업데이트 (liked, requested_phone 응답 기록)
CREATE POLICY "interactions_update_anon"
  ON public.property_interactions FOR UPDATE
  USING (true);

-- ── 4. Storage bucket for property photos ─────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('property-photos', 'property-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "property_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'property-photos');

CREATE POLICY "property_photos_agent_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'property-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "property_photos_agent_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'property-photos' AND auth.uid() IS NOT NULL);
