/**
 * GET  /api/agent/property  — 로그인 중개사의 매물 목록
 * POST /api/agent/property  — 매물 등록
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function yearToWithin(years: number): {
  within_4y: boolean; within_10y: boolean; within_15y: boolean; within_25y: boolean;
} {
  return {
    within_4y:  years <= 4,
    within_10y: years <= 10,
    within_15y: years <= 15,
    within_25y: years <= 25,
  };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const supabaseAdmin = getSupabaseAdmin();
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error: dbErr } = await supabaseAdmin
    .from("agent_properties")
    .select("*")
    .eq("agent_id", user.id)
    .order("created_at", { ascending: false });

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ properties: data });
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const supabaseAdmin = getSupabaseAdmin();
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json() as Record<string, unknown>;
  const builtYear = Number(body.built_year ?? 0);
  const withinFlags = yearToWithin(builtYear);

  const insert = {
    agent_id: user.id,
    address:         String(body.address ?? ""),
    lat:             Number(body.lat),
    lng:             Number(body.lng),
    trade_type:      String(body.trade_type ?? "월세"),
    property_type:   String(body.property_type ?? "원룸"),
    rooms:           Number(body.rooms ?? 1),
    parking:         Number(body.parking ?? 0),
    direction:       String(body.direction ?? ""),
    monthly_rent:    Number(body.monthly_rent ?? 0),
    deposit:         Number(body.deposit ?? 0),
    exclusive_area:  Number(body.exclusive_area ?? 0),
    maintenance_fee: Number(body.maintenance_fee ?? 0),
    has_elevator:          Boolean(body.has_elevator),
    has_closet:            Boolean(body.has_closet),
    has_builtin_closet:    Boolean(body.has_builtin_closet),
    has_entrance_security: Boolean(body.has_entrance_security),
    photo_urls:      Array.isArray(body.photo_urls) ? body.photo_urls : [],
    ...withinFlags,
  };

  const { data, error: insertErr } = await supabaseAdmin
    .from("agent_properties")
    .insert(insert)
    .select("id")
    .single();

  if (insertErr || !data) {
    return NextResponse.json({ error: insertErr?.message ?? "insert failed" }, { status: 500 });
  }

  // 비동기 backfill (응답을 기다리지 않음 — 오래 걸릴 수 있어서)
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${request.headers.get("host")}`;
  fetch(`${baseUrl}/api/agent/backfill-property`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ propertyId: (data as { id: string }).id }),
  }).catch(() => {/* fire-and-forget */});

  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}
