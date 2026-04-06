"use client";

import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { X, Home, MapPin, Clock, Bus, Lightbulb, Shield, ChevronDown, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Property } from "@/types";

interface PropertySheetProps {
  property: Property | null;
  open: boolean;
  onClose: () => void;
  onSelect: (property: Property) => void;
  walkTimeMin?: number;
  walkDistanceM?: number;
  busTimeMin?: number;
  streetLightCount?: number;
  streetLightDensity?: number;
  label?: string;
}

const DRAG_CLOSE_THRESHOLD = 100;

function formatDirection(dir: string | undefined): string {
  if (!dir) return "-";
  const map: Record<string, string> = {
    동향: "동", 서향: "서", 남향: "남", 북향: "북",
    남동향: "남동", 남서향: "남서", 북동향: "북동", 북서향: "북서",
  };
  return map[dir] ?? dir;
}

function buildYearLabel(p: Property): string {
  if (p.within_4y) return "4년 이내";
  if (p.within_10y) return "10년 이내";
  if (p.within_15y) return "15년 이내";
  if (p.within_25y) return "25년 이내";
  return "25년 초과";
}

function optionTags(p: Property): string[] {
  const tags: string[] = [];
  if (p.has_elevator) tags.push("엘리베이터");
  if (p.has_cctv) tags.push("CCTV");
  if (p.has_entrance_security) tags.push("현관보안");
  if (p.has_closet || p.has_builtin_closet) tags.push("수납공간");
  if (p.parking) tags.push("주차가능");
  return tags;
}

export default function PropertySheet({
  property,
  open,
  onClose,
  onSelect,
  walkTimeMin,
  walkDistanceM,
  busTimeMin,
  streetLightCount,
  streetLightDensity,
  label,
}: PropertySheetProps) {
  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DRAG_CLOSE_THRESHOLD) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && property && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-2xl bg-white shadow-2xl"
            style={{ maxHeight: "65vh" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1.5 w-10 rounded-full bg-gray-300" />
            </div>

            <div className="overflow-y-auto px-5 pb-6" style={{ maxHeight: "calc(65vh - 48px)" }}>
              {label && (
                <span className="mb-2 inline-block rounded-full bg-blue-100 px-3 py-0.5 text-xs font-semibold text-blue-700">
                  {label}
                </span>
              )}

              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    월세 {property.monthly_rent}만
                    <span className="ml-1 text-sm font-normal text-gray-500">
                      / 보증금 {property.deposit}만
                    </span>
                  </h2>
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-gray-500">
                    <MapPin className="size-3.5 shrink-0" />
                    {property.address}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div className="mb-4 grid grid-cols-3 gap-3">
                <InfoCell icon={<Home className="size-4" />} label="면적" value={`${(property.exclusive_area / 3.3058).toFixed(1)}평`} />
                <InfoCell icon={<Home className="size-4" />} label="방" value={`${property.rooms}개`} />
                <InfoCell icon={<ChevronDown className="size-4" />} label="방향" value={formatDirection(property.direction)} />
              </div>

              <div className="mb-4 grid grid-cols-3 gap-3">
                <InfoCell icon={<Clock className="size-4" />} label="관리비" value={`${(property.maintenance_fee / 10000).toFixed(1)}만`} />
                <InfoCell icon={<Home className="size-4" />} label="년식" value={buildYearLabel(property)} />
                <InfoCell icon={<Home className="size-4" />} label="유형" value={property.property_type} />
              </div>

              {(walkTimeMin !== undefined || streetLightCount !== undefined || property.noise_level != null) && (
                <div className="mb-4 rounded-xl bg-gray-50 p-3">
                  <p className="mb-2 text-xs font-semibold text-gray-500">이동 / 환경 정보</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    {walkTimeMin !== undefined && walkTimeMin > 0 && (
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-4 text-green-600" />
                        도보 {walkTimeMin}분
                        {walkDistanceM != null && walkDistanceM > 0 && (
                          <span className="text-xs text-gray-400">({(walkDistanceM / 1000).toFixed(1)}km)</span>
                        )}
                      </span>
                    )}
                    {busTimeMin != null && busTimeMin > 0 && (
                      <span className="flex items-center gap-1.5">
                        <Bus className="size-4 text-emerald-600" />
                        버스 {busTimeMin}분
                      </span>
                    )}
                    {streetLightCount != null && streetLightCount > 0 && (
                      <span className="flex items-center gap-1.5">
                        <Lightbulb className="size-4 text-yellow-500" />
                        가로등 {streetLightCount}개
                        {streetLightDensity != null && (
                          <span className="text-xs text-gray-400">({streetLightDensity.toFixed(1)}개/100m)</span>
                        )}
                      </span>
                    )}
                    {property.noise_level != null && (
                      <span className="flex items-center gap-1.5">
                        <Volume2 className="size-4 text-orange-500" />
                        소음 {property.noise_level}dB
                      </span>
                    )}
                  </div>
                </div>
              )}

              {optionTags(property).length > 0 && (
                <div className="mb-5 flex flex-wrap gap-2">
                  {optionTags(property).map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                    >
                      <Shield className="size-3" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <Button
                className="w-full py-6 text-base font-semibold"
                onClick={() => onSelect(property)}
              >
                이 매물 선택
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function InfoCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-gray-50 py-3">
      <span className="text-gray-400">{icon}</span>
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-gray-800">{value}</span>
    </div>
  );
}
