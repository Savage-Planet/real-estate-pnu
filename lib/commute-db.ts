import type { Property, Building } from "@/types";

/**
 * DB에 저장된 매물→정문·정문→건물 버스 소요(분) 합.
 * 둘 다 없으면 null (아직 백필 안 됨 → φ 0.5).
 */
export function busTotalMinutesFromDb(property: Property, building: Building): number | null {
  const pg = property.bus_to_gate_min;
  // 매물→정문 구간이 없으면 전체 버스 시간 미확정 → null 반환
  // (건물 구간만 있으면 모든 매물에 동일한 값이 표시되는 버그 방지)
  if (pg == null) return null;
  const bf = building.bus_from_gate_min;
  return pg + (bf ?? 0);
}
