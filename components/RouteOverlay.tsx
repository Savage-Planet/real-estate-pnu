"use client";

interface RouteOverlayProps {
  path: Array<{ lat: number; lng: number }>;
  mode?: "bus" | "walk";
}

export default function RouteOverlay({ path, mode = "walk" }: RouteOverlayProps) {
  return null;
}
