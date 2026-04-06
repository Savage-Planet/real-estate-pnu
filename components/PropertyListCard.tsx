"use client";

import { MapPin, Home, Clock } from "lucide-react";
import type { Property } from "@/types";

interface PropertyListCardProps {
  property: Property;
  rank: number;
  score: number;
  walkMin?: number;
  onClick?: () => void;
}

export default function PropertyListCard({
  property,
  rank,
  score,
  walkMin,
  onClick,
}: PropertyListCardProps) {
  return (
    <button
      className="flex w-full gap-3 rounded-2xl bg-white p-4 text-left shadow-sm transition active:scale-[0.98] hover:shadow-md"
      onClick={onClick}
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 text-sm font-bold text-white">
        {rank}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900">
          {property.monthly_rent}만/월
          <span className="ml-1 font-normal text-gray-400">
            보증금 {property.deposit}만
          </span>
        </p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-500">
          <MapPin className="size-3 shrink-0" />
          {property.address}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-gray-400">
          <span className="flex items-center gap-0.5">
            <Home className="size-3" />
            {(property.exclusive_area / 3.3058).toFixed(1)}평 · {property.rooms}방
          </span>
          {walkMin != null && walkMin > 0 && (
            <span className="flex items-center gap-0.5">
              <Clock className="size-3" />
              도보 {walkMin}분
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-center">
        <span className="text-xs text-gray-400">선호 점수</span>
        <span className="text-sm font-bold text-blue-600">
          {(score * 100).toFixed(0)}
        </span>
      </div>
    </button>
  );
}
