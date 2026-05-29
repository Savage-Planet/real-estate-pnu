/** GET /api/admin/debug — 인증 진단 (비밀값 노출 없음) */
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const received = (request.headers.get("x-admin-secret") ?? "").trim();
  const expected = (process.env.ADMIN_SECRET ?? "pnu-admin-2026").trim();
  return NextResponse.json({
    admin_secret_env_set: !!process.env.ADMIN_SECRET,
    expected_length: expected.length,
    received_length: received.length,
    match: received === expected,
    // 앞 2자리 + *** 로 확인 (실제 값 미노출)
    expected_prefix: expected.slice(0, 2) + "***",
    received_prefix: received.length > 0 ? received.slice(0, 2) + "***" : "(empty)",
  });
}
