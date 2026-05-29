/** GET /api/admin/stats — 전체 통계 (매물/세션/응답) */
import { NextResponse } from "next/server";
import { isAdminAuthed, getSupabaseAdmin } from "@/lib/admin-auth";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

async function count(db: SupabaseAdmin, table: string, col?: string, val?: unknown): Promise<number> {
  let q = db.from(table).select("*", { count: "exact", head: true });
  if (col !== undefined) q = q.eq(col, val as never);
  const { count: c } = await q;
  return c ?? 0;
}

export async function GET(request: Request) {
  if (!isAdminAuthed(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 환경변수 확인 — service role key 미설정이 가장 흔한 500 원인
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase 환경변수 누락 (NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  try {
    const db = getSupabaseAdmin();
    const [
      totalProperties,
      approvedProperties,
      pendingProperties,
      totalAgents,
      totalSessions,
      completedSessions,
      totalViews,
      likedYes,
      phoneRequested,
    ] = await Promise.all([
      count(db, "agent_properties"),
      count(db, "agent_properties", "approved", true),
      count(db, "agent_properties", "approved", false),
      count(db, "agent_profiles"),
      count(db, "user_sessions"),
      count(db, "user_sessions", "status", "completed"),
      count(db, "property_interactions"),
      count(db, "property_interactions", "liked", true),
      count(db, "property_interactions", "requested_phone", true),
    ]);

    return NextResponse.json({
      totalProperties,
      approvedProperties,
      pendingProperties,
      totalAgents,
      totalSessions,
      completedSessions,
      totalViews,
      likedYes,
      phoneRequested,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `통계 조회 실패: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
