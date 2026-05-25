/**
 * agent_properties 테이블 row를 Property 타입으로 변환하는 어댑터.
 * compare 페이지(학습)과 results 페이지(표시) 모두에서 사용.
 */
import type { Property } from "@/types";

/** agent_properties + agent_profiles 조인 결과 */
export interface AgentPropertyRow {
  id: string;
  agent_id: string;
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
  exclusive_area: number;
  maintenance_fee: number;
  has_elevator: boolean | null;
  has_closet: boolean | null;
  has_builtin_closet: boolean | null;
  has_entrance_security: boolean | null;
  within_4y: boolean | null;
  within_10y: boolean | null;
  within_15y: boolean | null;
  within_25y: boolean | null;
  photo_urls: string[];
  nearest_gate: string | null;
  walk_to_gate_min: number | null;
  walk_to_gate_m: number | null;
  walk_to_gate_route: Array<[number, number]> | null;
  bus_to_gate_min: number | null;
  bus_to_gate_transfers: number | null;
  noise_level: number | null;
  is_active: boolean;
  created_at: string;
  // joined from agent_profiles
  agent_username?: string;
  agent_phone?: string;
  agent_office_address?: string;
}

export function agentRowToProperty(row: AgentPropertyRow): Property {
  return {
    id: row.id,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    trade_type: row.trade_type,
    property_type: row.property_type,
    rooms: row.rooms,
    parking: row.parking,
    direction: row.direction,
    monthly_rent: row.monthly_rent,
    deposit: row.deposit,
    // agent_properties에는 supply_area, area_ratio가 없어서 계산 추정값 사용
    supply_area: row.exclusive_area * 1.2,
    exclusive_area: row.exclusive_area,
    area_ratio: 1,
    maintenance_fee: row.maintenance_fee,
    has_elevator: row.has_elevator,
    within_25y: row.within_25y,
    within_15y: row.within_15y,
    within_10y: row.within_10y,
    within_4y: row.within_4y,
    has_closet: row.has_closet,
    has_builtin_closet: row.has_builtin_closet,
    has_entrance_security: row.has_entrance_security,
    has_cctv: null,
    noise_level: row.noise_level,
    nearest_gate: row.nearest_gate,
    straight_dist_to_gate: null,
    walk_to_gate_min: row.walk_to_gate_min,
    walk_to_gate_m: row.walk_to_gate_m,
    walk_to_gate_route: row.walk_to_gate_route,
    bus_to_gate_min: row.bus_to_gate_min,
    bus_to_gate_transfers: row.bus_to_gate_transfers,
    created_at: row.created_at,
  };
}
