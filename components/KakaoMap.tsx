"use client";

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";

export interface KakaoMapMarker {
  lat: number;
  lng: number;
  label?: string;
  color?: "red" | "blue" | "star" | "light";
  excludeFromBounds?: boolean;
}

export interface KakaoMapPolyline {
  path: Array<{ lat: number; lng: number }>;
  color?: string;
  weight?: number;
  opacity?: number;
  style?: string;
}

export interface KakaoMapHandle {
  getMap: () => kakao.maps.Map | null;
  panTo: (lat: number, lng: number) => void;
}

interface KakaoMapProps {
  center?: { lat: number; lng: number };
  level?: number;
  markers?: KakaoMapMarker[];
  polylines?: KakaoMapPolyline[];
  className?: string;
  autoFit?: boolean;
  fitPadding?: number;
  onMarkerClick?: (marker: KakaoMapMarker, index: number) => void;
}

const BUSAN_UNIV_CENTER = { lat: 35.2340, lng: 129.0800 };
const KAKAO_SDK_URL = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${process.env.NEXT_PUBLIC_KAKAO_MAP_KEY}&autoload=false`;

let sdkPromise: Promise<void> | null = null;

function loadKakaoSDK(): Promise<void> {
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    if (window.kakao?.maps) {
      window.kakao.maps.load(() => resolve());
      return;
    }

    const script = document.createElement("script");
    script.src = KAKAO_SDK_URL;
    script.async = true;
    script.onload = () => {
      window.kakao.maps.load(() => resolve());
    };
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("Kakao Maps SDK failed to load"));
    };
    document.head.appendChild(script);
  });

  return sdkPromise;
}

function getMarkerImage(color?: string): { src: string; size: number } {
  switch (color) {
    case "blue":
      return {
        src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="10" fill="#3b82f6" stroke="white" stroke-width="2"/></svg>')}`,
        size: 28,
      };
    case "star":
      return {
        src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><polygon points="14,2 17.5,10.5 27,10.5 19.5,16.5 22,25 14,20 6,25 8.5,16.5 1,10.5 10.5,10.5" fill="#f59e0b" stroke="white" stroke-width="1.5"/></svg>')}`,
        size: 28,
      };
    case "light":
      return {
        src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><circle cx="6" cy="6" r="4" fill="#facc15" stroke="#a16207" stroke-width="1"/></svg>')}`,
        size: 12,
      };
    case "red":
    default:
      return {
        src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="10" fill="#ef4444" stroke="white" stroke-width="2"/></svg>')}`,
        size: 28,
      };
  }
}

const KakaoMap = forwardRef<KakaoMapHandle, KakaoMapProps>(
  ({ center, level = 4, markers = [], polylines = [], className, autoFit = false, fitPadding = 80, onMarkerClick }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<kakao.maps.Map | null>(null);
    const markerRefs = useRef<kakao.maps.Marker[]>([]);
    const overlayRefs = useRef<kakao.maps.CustomOverlay[]>([]);
    const polylineRefs = useRef<kakao.maps.Polyline[]>([]);
    const [ready, setReady] = useState(false);

    useImperativeHandle(ref, () => ({
      getMap: () => mapRef.current,
      panTo: (lat: number, lng: number) => {
        if (mapRef.current) {
          mapRef.current.setCenter(new window.kakao.maps.LatLng(lat, lng));
        }
      },
    }));

    useEffect(() => {
      let cancelled = false;

      loadKakaoSDK()
        .then(() => {
          if (cancelled || !containerRef.current) return;

          const c = center ?? BUSAN_UNIV_CENTER;
          const map = new window.kakao.maps.Map(containerRef.current, {
            center: new window.kakao.maps.LatLng(c.lat, c.lng),
            level,
          });
          mapRef.current = map;
          setReady(true);
        })
        .catch((err) => {
          console.error(err);
        });

      return () => {
        cancelled = true;
      };
    }, []);

    useEffect(() => {
      if (!mapRef.current || !center) return;
      mapRef.current.setCenter(
        new window.kakao.maps.LatLng(center.lat, center.lng),
      );
    }, [center]);

    useEffect(() => {
      if (!mapRef.current) return;
      mapRef.current.setLevel(level);
    }, [level]);

    const clearMarkers = useCallback(() => {
      markerRefs.current.forEach((m) => m.setMap(null));
      markerRefs.current = [];
      overlayRefs.current.forEach((o) => o.setMap(null));
      overlayRefs.current = [];
    }, []);

    useEffect(() => {
      if (!ready || !mapRef.current) return;
      clearMarkers();

      const map = mapRef.current;

      markers.forEach((m, i) => {
        const position = new window.kakao.maps.LatLng(m.lat, m.lng);
        const img = getMarkerImage(m.color);
        const half = img.size / 2;

        const imageSize = new window.kakao.maps.Size(img.size, img.size);
        const imageOption = { offset: new window.kakao.maps.Point(half, half) };
        const markerImage = new window.kakao.maps.MarkerImage(img.src, imageSize, imageOption);

        const marker = new window.kakao.maps.Marker({
          position,
          map,
          image: markerImage,
          clickable: m.color !== "light",
        });

        if (m.label) {
          const overlay = new window.kakao.maps.CustomOverlay({
            position,
            content: `<div style="padding:2px 8px;background:white;border:1px solid #ddd;border-radius:4px;font-size:12px;font-weight:600;white-space:nowrap;transform:translateY(-36px)">${m.label}</div>`,
            map,
            yAnchor: 1,
          });
          overlayRefs.current.push(overlay);
        }

        if (onMarkerClick && m.color !== "light") {
          window.kakao.maps.event.addListener(marker, "click", () => {
            onMarkerClick(m, i);
          });
        }

        markerRefs.current.push(marker);
      });
    }, [ready, markers, onMarkerClick, clearMarkers]);

    useEffect(() => {
      if (!ready || !mapRef.current || !autoFit) return;
      const boundsMarkers = markers.filter((m) => !m.excludeFromBounds);
      if (boundsMarkers.length < 2) return;
      const bounds = new window.kakao.maps.LatLngBounds();
      boundsMarkers.forEach((m) =>
        bounds.extend(new window.kakao.maps.LatLng(m.lat, m.lng)),
      );
      mapRef.current.setBounds(bounds, fitPadding);
    }, [ready, markers, autoFit, fitPadding]);

    useEffect(() => {
      polylineRefs.current.forEach((pl) => pl.setMap(null));
      polylineRefs.current = [];

      if (!ready || !mapRef.current) return;
      const map = mapRef.current;

      polylines.forEach((pl) => {
        if (pl.path.length < 2) return;
        const linePath = pl.path.map(
          (p) => new window.kakao.maps.LatLng(p.lat, p.lng),
        );
        const polyline = new window.kakao.maps.Polyline({
          path: linePath,
          strokeWeight: pl.weight ?? 4,
          strokeColor: pl.color ?? "#3b82f6",
          strokeOpacity: pl.opacity ?? 0.8,
          strokeStyle: pl.style ?? "solid",
          map,
        });
        polylineRefs.current.push(polyline);
      });
    }, [ready, polylines]);

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ width: "100%", height: "100%", minHeight: "200px" }}
      />
    );
  },
);

KakaoMap.displayName = "KakaoMap";

export default KakaoMap;
