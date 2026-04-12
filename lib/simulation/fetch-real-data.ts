import { createClient } from "@supabase/supabase-js";
import type { Property, Building } from "@/types";
import type { CommuteFeatures, FeatureStats } from "../feature-engineer";
import { computeStats } from "../feature-engineer";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, key);
}

export async function fetchRealData(buildingId?: string): Promise<{
  properties: Property[];
  building: Building;
  stats: FeatureStats;
  commuteById: Map<string, CommuteFeatures>;
}> {
  const supabase = getSupabase();

  const { data: buildings, error: bErr } = await supabase
    .from("buildings")
    .select("*")
    .limit(10);
  if (bErr) throw new Error(`buildings fetch error: ${bErr.message}`);
  if (!buildings || buildings.length === 0) throw new Error("No buildings found");

  const building = (buildingId
    ? buildings.find((b: Building) => b.id === buildingId)
    : buildings[0]) as Building;
  if (!building) throw new Error(`Building ${buildingId} not found`);

  const { data: props, error: pErr } = await supabase
    .from("properties")
    .select("*");
  if (pErr) throw new Error(`properties fetch error: ${pErr.message}`);
  if (!props || props.length === 0) throw new Error("No properties found");

  const properties = props as Property[];
  const stats = computeStats(properties);

  const commuteById = new Map<string, CommuteFeatures>();
  const walks: number[] = [];
  const busTotals: number[] = [];

  for (const p of properties) {
    const walkMin = p.walk_to_gate_min ?? 20;
    const pg = p.bus_to_gate_min;
    const bf = building.bus_from_gate_min;
    const busTotalMin = (pg != null || bf != null) ? (pg ?? 0) + (bf ?? 0) : null;

    commuteById.set(p.id, { walkMin, busTotalMin });
    if (walkMin > 0) walks.push(walkMin);
    if (busTotalMin != null) busTotals.push(busTotalMin);
  }

  stats.commuteWalkMin = walks.length > 0
    ? { min: Math.min(...walks), max: Math.max(...walks) }
    : { min: 5, max: 45 };
  stats.commuteBusTotalMin = busTotals.length > 0
    ? { min: Math.min(...busTotals), max: Math.max(...busTotals) }
    : { min: 0, max: 90 };

  return { properties, building, stats, commuteById };
}
