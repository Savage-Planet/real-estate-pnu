/** GET /api/admin/stats — 전체 통계 (매물/세션/응답) */
import { NextResponse } from "next/server";
import { isAdminAuthed, supabaseAdmin } from "@/lib/admin-auth";

async function count(table: string, col?: string, val?: unknown): Promise<number> {
  let q = supabaseAdmin.from(table).select("*", { count: "exact", head: true });
  if (col !== undefined) q = q.eq(col, val as never);
  const { count: c } = await q;
  return c ?? 0;
}

export async function GET(request: Request) {
  if (!isAdminAuthed(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
    count("agent_properties"),
    count("agent_properties", "approved", true),
    count("agent_properties", "approved", false),
    count("agent_profiles"),
    count("user_sessions"),
    count("user_sessions", "status", "completed"),
    count("property_interactions"),
    count("property_interactions", "liked", true),
    count("property_interactions", "requested_phone", true),
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
}
