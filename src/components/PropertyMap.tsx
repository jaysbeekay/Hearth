"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import type { MapTileConfig } from "@/lib/mapTiles";

export function PropertyMap({
  lat,
  lng,
  label,
  tiles,
}: {
  lat: number;
  lng: number;
  label: string;
  /** Resolved server-side from MAP_TILE_* (src/lib/mapTiles.ts, #338). */
  tiles: MapTileConfig;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      if (cancelled || !containerRef.current || mapRef.current) return;

      delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "/leaflet/marker-icon-2x.png",
        iconUrl: "/leaflet/marker-icon.png",
        shadowUrl: "/leaflet/marker-shadow.png",
      });

      const map = L.map(containerRef.current).setView([lat, lng], 15);
      // See src/lib/mapTiles.ts for why this is OpenStreetMap by default and
      // configurable via MAP_TILE_URL (#338, superseding CARTO from #130).
      L.tileLayer(tiles.url, {
        attribution: tiles.attribution,
        maxZoom: 19,
        ...(tiles.subdomains ? { subdomains: tiles.subdomains } : {}),
        // The app sends `Referrer-Policy: no-referrer` everywhere (proxy.ts),
        // but OpenStreetMap's tile servers refuse requests with no Referer.
        // Send only the app's origin, and only on these tile requests.
        referrerPolicy: "strict-origin",
      }).addTo(map);
      L.marker([lat, lng]).addTo(map).bindPopup(label);
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lng, label, tiles.url, tiles.attribution, tiles.subdomains]);

  return (
    <div
      ref={containerRef}
      className="h-64 w-full overflow-hidden rounded-xl border border-border"
    />
  );
}
