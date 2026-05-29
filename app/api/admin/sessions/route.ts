/** GET /api/admin/sessions — 사용자 세션 로그 + 세션별 매물 조회/응답 */
import { NextResponse } from "next/server";
import { isAdminAuthed, getSupabaseAdmin } from "@/lib/admin-auth";

export async function GET(request: Request) {
  if (!isAdminAuthed(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabaseAdmin = getSupabaseAdmin();
  const { data: sessions, error } = await supabaseAdmin
    .from("user_sessions")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 세션별 인터랙션 (조회 매물 수 / Q1·Q2 응답)
  const { data: interactions } = await supabaseAdmin
    .from("property_interactions")
    .select("session_id, agent_property_id, liked, requested_phone, viewed_at");

  const bySession = new Map<string, {
    viewed: number; likedYes: number; likedNo: number; phoneYes: number; phoneNo: number;
  }>();
  for (const it of interactions ?? []) {
    const row = it as { session_id: string; liked: boolean | null; requested_phone: boolean | null };
    const s = bySession.get(row.session_id) ?? { viewed: 0, likedYes: 0, likedNo: 0, phoneYes: 0, phoneNo: 0 };
    s.viewed += 1;
    if (row.liked === true) s.likedYes += 1;
    if (row.liked === false) s.likedNo += 1;
    if (row.requested_phone === true) s.phoneYes += 1;
    if (row.requested_phone === false) s.phoneNo += 1;
    bySession.set(row.session_id, s);
  }

  const enriched = (sessions ?? []).map((sess) => {
    const row = sess as { session_id: string } & Record<string, unknown>;
    const s = bySession.get(row.session_id) ?? { viewed: 0, likedYes: 0, likedNo: 0, phoneYes: 0, phoneNo: 0 };
    return { ...row, ...s };
  });

  return NextResponse.json({ sessions: enriched });
}
