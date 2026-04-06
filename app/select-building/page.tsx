"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Search, MapPin, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import KakaoMap, { type KakaoMapMarker } from "@/components/KakaoMap";
import { supabase } from "@/lib/supabase";
import type { Building } from "@/types";

export default function SelectBuildingPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Building[]>([]);
  const [selected, setSelected] = useState<Building | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const searchBuildings = useCallback(async (q: string) => {
    if (q.trim().length === 0) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("buildings")
        .select("*")
        .or(`name.ilike.%${q}%,building_code.ilike.%${q}%`)
        .limit(10);

      if (!error && data) {
        setResults(data as Building[]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchBuildings(query);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, searchBuildings]);

  const handleSelect = (building: Building) => {
    setSelected(building);
    setResults([]);
    setQuery(building.name);
  };

  const handleReset = () => {
    setSelected(null);
    setQuery("");
    inputRef.current?.focus();
  };

  const handleConfirm = () => {
    if (!selected) return;
    router.push(`/filter?building=${selected.id}`);
  };

  const mapMarkers: KakaoMapMarker[] = selected
    ? [{ lat: selected.lat, lng: selected.lng, label: selected.name, color: "star" }]
    : [];

  const mapCenter = selected
    ? { lat: selected.lat, lng: selected.lng }
    : undefined;

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <div className="relative flex flex-1 flex-col min-h-0">
        {/* 지도 영역 */}
        <div className="flex-1 relative min-h-0">
          <KakaoMap
            center={mapCenter}
            level={selected ? 3 : 4}
            markers={mapMarkers}
            className="absolute inset-0"
          />

          {/* 선택된 건물이 없을 때 지도 위 안내 */}
          {!selected && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-2xl bg-background/80 backdrop-blur px-6 py-4 text-center shadow-lg"
              >
                <MapPin className="mx-auto mb-2 size-8 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">
                  건물을 검색하면<br />지도에 위치가 표시됩니다
                </p>
              </motion.div>
            </div>
          )}
        </div>

        {/* 하단 검색 패널 */}
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="shrink-0 rounded-t-3xl bg-background border-t shadow-[0_-4px_24px_rgba(0,0,0,0.08)] px-5 pb-6 pt-5"
        >
          <div className="mx-auto max-w-md flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                1 / 4 단계
              </p>
              <h1 className="mt-0.5 text-lg font-bold tracking-tight">
                자주 가는 건물을 검색하세요
              </h1>
            </div>

            {/* 검색 입력 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                ref={inputRef}
                placeholder="건물 이름 또는 건물 번호 검색"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (selected) setSelected(null);
                }}
                className="pl-9 pr-9 h-12 rounded-xl text-base"
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    setResults([]);
                    setSelected(null);
                    inputRef.current?.focus();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {/* 검색 결과 드롭다운 */}
            <AnimatePresence>
              {results.length > 0 && !selected && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="rounded-xl border bg-card shadow-md overflow-hidden max-h-52 overflow-y-auto"
                >
                  {results.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => handleSelect(b)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors border-b last:border-b-0"
                    >
                      <MapPin className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {b.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {b.building_code} · {b.address}
                        </p>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* 로딩 */}
            {loading && !selected && query.length > 0 && results.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                검색 중…
              </p>
            )}

            {/* 검색 결과 없음 */}
            {!loading && !selected && query.length > 0 && results.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                검색 결과가 없습니다
              </p>
            )}

            {/* 선택된 건물 표시 */}
            <AnimatePresence>
              {selected && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className="flex items-center gap-3 rounded-xl border-2 border-primary bg-primary/5 p-4"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <MapPin className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{selected.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {selected.building_code} · {selected.address}
                    </p>
                  </div>
                  <button
                    onClick={handleReset}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 버튼 영역 */}
            <div className="flex gap-3 pt-1">
              {selected && (
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 rounded-xl flex-1"
                  onClick={handleReset}
                >
                  다시 검색
                </Button>
              )}
              <Button
                size="lg"
                className="h-12 rounded-xl flex-1 gap-2 text-base font-semibold"
                disabled={!selected}
                onClick={handleConfirm}
              >
                확인
                <ArrowRight className="size-5" />
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
