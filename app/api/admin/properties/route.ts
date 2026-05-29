/** GET /api/admin/properties — 전체 매물 + 중개사 정보 + 조회/응답 통계 */
import { NextResponse } from "next/server";
import { isAdminAuthed, getSupabaseAdmin } from "@/lib/admin-auth";

export async function GET(request: Request) {
  if (!isAdminAuthed(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabaseAdmin = getSupabaseAdmin();
  const { data: props, error } = await supabaseAdmin
    .from("agent_properties")
    .select("*, agent_profiles(username, phone, office_address)")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 매물별 인터랙션 집계
  const { data: interactions } = await supabaseAdmin
    .from("property_interactions")
    .select("agent_property_id, liked, requested_phone");

  const statsByProp = new Map<string, { views: number; liked: number; phone: number }>();
  for (const it of interactions ?? []) {
    const row = it as { agent_property_id: string; liked: boolean | null; requested_phone: boolean | null };
    const s = statsByProp.get(row.agent_property_id) ?? { views: 0, liked: 0, phone: 0 };
    s.views += 1;
    if (row.liked === true) s.liked += 1;
    if (row.requested_phone === true) s.phone += 1;
    statsByProp.set(row.agent_property_id, s);
  }

  const enriched = (props ?? []).map((p) => {
    const row = p as { id: string } & Record<string, unknown>;
    const s = statsByProp.get(row.id) ?? { views: 0, liked: 0, phone: 0 };
    return { ...row, _views: s.views, _liked: s.liked, _phone: s.phone };
  });

  return NextResponse.json({ properties: enriched });
}
