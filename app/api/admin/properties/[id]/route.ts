/** PATCH /api/admin/properties/[id] — 매물 승인/거부 (approved 토글) */
import { NextResponse } from "next/server";
import { isAdminAuthed, supabaseAdmin } from "@/lib/admin-auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAdminAuthed(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { approved } = (await request.json()) as { approved: boolean };

  const { error } = await supabaseAdmin
    .from("agent_properties")
    .update({ approved })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
