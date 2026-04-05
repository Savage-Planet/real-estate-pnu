declare namespace kakao.maps {
  class Map {
    constructor(container: HTMLElement, options: MapOptions);
    setCenter(latlng: LatLng): void;
    setLevel(level: number): void;
    getCenter(): LatLng;
    getLevel(): number;
    relayout(): void;
    setBounds(bounds: LatLngBounds, paddingX?: number, paddingY?: number): void;
  }

  class LatLng {
    constructor(lat: number, lng: number);
    getLat(): number;
    getLng(): number;
  }

  class Marker {
    constructor(options: MarkerOptions);
    setMap(map: Map | null): void;
    setPosition(position: LatLng): void;
    getPosition(): LatLng;
    setImage(image: MarkerImage): void;
  }

  class MarkerImage {
    constructor(
      src: string,
      size: Size,
      options?: { offset?: Point; shape?: string; coords?: string },
    );
  }

  class Size {
    constructor(width: number, height: number);
  }

  class Point {
    constructor(x: number, y: number);
  }

  class LatLngBounds {
    constructor();
    extend(latlng: LatLng): void;
  }

  class Polyline {
    constructor(options: PolylineOptions);
    setMap(map: Map | null): void;
    getLength(): number;
  }

  class InfoWindow {
    constructor(options: InfoWindowOptions);
    open(map: Map, marker: Marker): void;
    close(): void;
    setContent(content: string): void;
  }

  class CustomOverlay {
    constructor(options: CustomOverlayOptions);
    setMap(map: Map | null): void;
  }

  interface MapOptions {
    center: LatLng;
    level?: number;
  }

  interface MarkerOptions {
    position: LatLng;
    map?: Map;
    image?: MarkerImage;
    clickable?: boolean;
  }

  interface PolylineOptions {
    path: LatLng[];
    strokeWeight?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeStyle?: string;
    map?: Map;
  }

  interface InfoWindowOptions {
    content?: string;
    position?: LatLng;
    removable?: boolean;
  }

  interface CustomOverlayOptions {
    position: LatLng;
    content: string | HTMLElement;
    map?: Map;
    yAnchor?: number;
    xAnchor?: number;
  }

  namespace event {
    function addListener(
      target: Marker | Map,
      type: string,
      handler: (...args: unknown[]) => void,
    ): void;
    function removeListener(
      target: Marker | Map,
      type: string,
      handler: (...args: unknown[]) => void,
    ): void;
  }

  function load(callback: () => void): void;
}

interface Window {
  kakao: {
    maps: typeof kakao.maps & {
      load: (callback: () => void) => void;
    };
  };
}
