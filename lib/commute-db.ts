import type { Property, Building } from "@/types";

/**
 * DB에 저장된 매물→정문·정문→건물 버스 소요(분) 합.
 * 둘 다 없으면 null (아직 백필 안 됨 → φ 0.5).
 */
export function busTotalMinutesFromDb(property: Property, building: Building): number | null {
  const pg = property.bus_to_gate_min;
  const bf = building.bus_from_gate_min;
  if (pg == null && bf == null) return null;
  return (pg ?? 0) + (bf ?? 0);
}
