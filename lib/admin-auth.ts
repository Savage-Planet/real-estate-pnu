/**
 * 관리자 API 인증 헬퍼.
 * x-admin-secret 헤더를 ADMIN_SECRET env(미설정 시 기본값)와 비교한다.
 */
import { createClient } from "@supabase/supabase-js";

export function isAdminAuthed(request: Request): boolean {
  // 매 요청마다 env를 읽어야 빌드 타임 고착 문제가 없음
  const expected = (process.env.ADMIN_SECRET ?? "pnu-admin-2026").trim();
  const secret = (request.headers.get("x-admin-secret") ?? "").trim();
  return secret === expected;
}

export function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
