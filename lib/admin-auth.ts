/**
 * 관리자 API 인증 헬퍼.
 * x-admin-secret 헤더를 ADMIN_SECRET env(미설정 시 기본값)와 비교한다.
 */
import { createClient } from "@supabase/supabase-js";

export const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "pnu-admin-2026";

export function isAdminAuthed(request: Request): boolean {
  const secret = request.headers.get("x-admin-secret") ?? "";
  return secret === ADMIN_SECRET;
}

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
