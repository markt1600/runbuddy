"use client";

import { useEffect, useRef } from "react";
import type { RunStats } from "@/lib/types";

// A real map for a saved run: OpenStreetMap tiles under the route polyline.
// Leaflet is loaded on demand — it only costs anyone anything on the one
// screen that uses it, and the summary screen keeps its tile-free silhouette
// (drawn fresh at the finish line, where flaky mobile data can't blank it).

interface Props {
  route: RunStats["route"];
  accent: string;
}

export default function RouteTileMap({ route, accent }: Props) {
  const holderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!holderRef.current || route.length < 2) return;
    let disposed = false;
    let map: import("leaflet").Map | null = null;

    void import("leaflet").then((mod) => {
      const L = mod.default ?? mod;
      if (disposed || !holderRef.current) return;
      map = L.map(holderRef.current, {
        zoomControl: false, // pinch and double-tap cover it on the phone
        attributionControl: true,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);

      const latlngs = route.map((p) => [p.lat, p.lon] as [number, number]);
      L.polyline(latlngs, {
        color: accent,
        weight: 4,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);
      // Same start/finish colours as the shareable card.
      const dot = (at: [number, number], fill: string) =>
        L.circleMarker(at, {
          radius: 6,
          color: "#f5efe2",
          weight: 2,
          fillColor: fill,
          fillOpacity: 1,
        }).addTo(map!);
      dot(latlngs[0], "#3f7d3f");
      dot(latlngs[latlngs.length - 1], "#b3271b");

      map.fitBounds(L.latLngBounds(latlngs), { padding: [28, 28] });
    });

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [route, accent]);

  if (route.length < 2) return null;
  return <div ref={holderRef} className="route-tile-map" />;
}
