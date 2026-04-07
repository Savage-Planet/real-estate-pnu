export interface Property {
  id: string;
  address: string;
  lat: number;
  lng: number;

  trade_type: string;
  property_type: string;
  rooms: number;
  parking: number;
  direction: string;

  monthly_rent: number;
  deposit: number;
  supply_area: number;
  exclusive_area: number;
  area_ratio: number;
  maintenance_fee: number;

  has_elevator: boolean | null;
  within_25y: boolean | null;
  within_15y: boolean | null;
  within_10y: boolean | null;
  within_4y: boolean | null;

  has_closet: boolean | null;
  has_builtin_closet: boolean | null;
  has_entrance_security: boolean | null;
  has_cctv: boolean | null;

  noise_level: number | null;

  nearest_gate: string | null;
  straight_dist_to_gate: number | null;
  walk_to_gate_min: number | null;
  walk_to_gate_m: number | null;
  walk_to_gate_route: Array<[number, number]> | null;

  /** ODsay 백필: 매물 → 부산대 정문 버스 소요(분) */
  bus_to_gate_min?: number | null;
  bus_to_gate_transfers?: number | null;
  bus_to_gate_info?: unknown;

  raw_features?: unknown;
  feature_vector?: number[];
  created_at?: string;
}

export interface Building {
  id: string;
  building_code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  nearest_gate: string | null;
  straight_dist_to_gate: number | null;

  /** ODsay 백필: 정문 → 건물 버스 소요(분) */
  bus_from_gate_min?: number | null;
  bus_from_gate_transfers?: number | null;
  bus_from_gate_info?: unknown;
}

export interface Gate {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface BuildingGateRoute {
  id: number;
  building_id: string;
  gate_id: string;
  walk_time_min: number;
  walk_distance_m: number;
  walk_route: Array<[number, number]> | null;
}

export interface StreetLight {
  id: number;
  lat: number;
  lng: number;
}

export interface Comparison {
  id: string;
  session_id: string;
  property_a: string;
  property_b: string;
  preferred: "a" | "b";
  round: number;
  created_at?: string;
}

export interface PriceFilter {
  minRent: number;
  maxRent: number;
  minDeposit: number;
  maxDeposit: number;
}
