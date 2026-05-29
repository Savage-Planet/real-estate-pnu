/** GET /api/admin/debug — 인증 진단 (비밀값 노출 없음) */
import { NextResponse } from "next/server";

export async function GET() {
  const expected = (
    process.env.ADMIN_PW ??
    process.env.ADMIN_SECRET ??
    "pnu-admin-2026"
  ).trim();
  return NextResponse.json({
    ADMIN_PW_set: !!process.env.ADMIN_PW,
    ADMIN_SECRET_set: !!process.env.ADMIN_SECRET,
    expected_length: expected.length,
    expected_prefix: expected.slice(0, 2) + "***",
    using_default: !process.env.ADMIN_PW && !process.env.ADMIN_SECRET,
  });
}
