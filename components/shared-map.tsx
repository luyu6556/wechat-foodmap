"use client";

import { useCallback, useEffect, useState } from "react";
import AmapCanvas from "./amap-canvas";
import OsmCanvas, { type MapPlace } from "./map-canvas";

type Props = {
  places?: MapPlace[];
  selectedId?: string | null;
  picked?: { lat: number; lng: number } | null;
  pickMode?: boolean;
  onSelect?: (id: string) => void;
  onPick?: (point: { lat: number; lng: number }) => void;
  className?: string;
};

type MapConfig = { provider: "amap" | "osm"; key?: string; useProxy?: boolean };

export default function SharedMap(props: Props) {
  const [config, setConfig] = useState<MapConfig | null>(null);
  const fallback = useCallback(() => setConfig({ provider: "osm" }), []);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/map/config").then((response) => response.json() as Promise<{ provider?: string; key?: string; useProxy?: boolean }>).then((value) => {
      if (!cancelled) setConfig(value.provider === "amap" && value.key ? { provider: "amap", key: value.key, useProxy: Boolean(value.useProxy) } : { provider: "osm" });
    }).catch(() => { if (!cancelled) setConfig({ provider: "osm" }); });
    return () => { cancelled = true; };
  }, []);
  if (!config) return <div className={`map-canvas map-loading ${props.className || ""}`} role="status">正在加载地图…</div>;
  if (config.provider === "amap" && config.key) return <AmapCanvas {...props} apiKey={config.key} useProxy={config.useProxy} onError={fallback} />;
  return <OsmCanvas {...props} />;
}
