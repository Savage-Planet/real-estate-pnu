/**
 * 관리자 API 인증 헬퍼.
 * x-admin-secret 헤더를 ADMIN_SECRET env(미설정 시 기본값)와 비교한다.
 */
import { createClient } from "@supabase/supabase-js";

export function isAdminAuthed(request: Request): boolean {
  // ADMIN_PW 우선, 없으면 ADMIN_SECRET, 없으면 기본값
  const expected = (
    process.env.ADMIN_PW ??
    process.env.ADMIN_SECRET ??
    "pnu-admin-2026"
  ).trim();
  const secret = (request.headers.get("x-admin-secret") ?? "").trim();
  return secret === expected;
}

export function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
