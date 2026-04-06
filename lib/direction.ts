/**
 * DB 방향은 남향 | 북향 만 사용.
 * 구 8방향 값이 남아 있을 때 비교·표시용으로만 매핑.
 */
export type DirectionSouthNorth = "남향" | "북향";

const SOUTH_GROUP = new Set(["남향", "남동향", "남서향", "동향"]);
const NORTH_GROUP = new Set(["북향", "북동향", "북서향", "서향"]);

export function mapLegacyDirectionToSouthNorth(direction: string | null | undefined): DirectionSouthNorth {
  if (!direction || !direction.trim()) return "남향";
  const d = direction.trim();
  if (d === "남향" || d === "북향") return d as DirectionSouthNorth;
  if (SOUTH_GROUP.has(d)) return "남향";
  if (NORTH_GROUP.has(d)) return "북향";
  return "남향";
}

/** 특징 벡터용: 남향 [1,0], 북향 [0,1] */
export function directionSouthNorthOneHot(direction: string | null | undefined): [number, number] {
  const d = mapLegacyDirectionToSouthNorth(direction);
  return d === "남향" ? [1, 0] : [0, 1];
}
