"use client";

import { useEffect, useRef, useState } from "react";
import { gcjToWgs, wgsToGcj } from "../lib/resolve";
import { normalizeColor } from "../lib/color";
import type { MapPlace } from "./map-canvas";

type Coord = [number, number]; // lng, lat in GCJ-02
type AMapEvent = { lnglat: { getLat: () => number; getLng: () => number } };
type AMapMarker = { on: (name: string, handler: () => void) => void };
type AMapMap = {
  on: (name: string, handler: (event: AMapEvent) => void) => void;
  add: (markers: AMapMarker[]) => void;
  remove: (markers: AMapMarker[]) => void;
  setCenter: (point: Coord) => void;
  setZoom: (zoom: number) => void;
  getZoom: () => number;
  destroy: () => void;
};
type AMapGlobal = {
  Map: new (node: HTMLElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => AMapMarker;
};
declare global {
  interface Window { AMap?: AMapGlobal; _AMapSecurityConfig?: { serviceHost: string } }
}

let loader: Promise<AMapGlobal> | null = null;
function loadAmap(key: string, useProxy: boolean) {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (!loader) loader = new Promise<AMapGlobal>((resolve, reject) => {
    // 仅在配置了安全密钥时才指向同源代理。没有安全密钥时代理会返回 503，
    // 反而把地图自身的服务请求打断，所以这种情况必须直连高德。
    if (useProxy) window._AMapSecurityConfig = { serviceHost: `${window.location.origin}/api/map/_AMapService` };
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.async = true;
    script.onload = () => window.AMap ? resolve(window.AMap) : reject(new Error("地图接口未加载"));
    script.onerror = () => reject(new Error("地图接口加载失败"));
    document.head.appendChild(script);
  }).catch((error) => { loader = null; throw error; });
  return loader;
}

type Props = {
  apiKey: string;
  useProxy?: boolean;
  places?: MapPlace[];
  selectedId?: string | null;
  focusId?: string | null;
  picked?: { lat: number; lng: number } | null;
  pickMode?: boolean;
  onSelect?: (id: string) => void;
  onPick?: (point: { lat: number; lng: number }) => void;
  onBlankClick?: () => void;
  onError?: () => void;
  className?: string;
};

export default function AmapCanvas({ apiKey, useProxy, places = [], selectedId, focusId, picked, pickMode, onSelect, onPick, onBlankClick, onError, className = "" }: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const amapRef = useRef<AMapGlobal | null>(null);
  const markersRef = useRef<AMapMarker[]>([]);
  const selectRef = useRef(onSelect);
  const pickRef = useRef(onPick);
  const blankRef = useRef(onBlankClick);
  const pickModeRef = useRef(pickMode);
  const initialFitRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => { selectRef.current = onSelect; pickRef.current = onPick; blankRef.current = onBlankClick; pickModeRef.current = pickMode; }, [onSelect, onPick, onBlankClick, pickMode]);
  useEffect(() => {
    let cancelled = false;
    let current: AMapMap | null = null;
    void loadAmap(apiKey, Boolean(useProxy)).then((AMap) => {
      if (cancelled || !elementRef.current) return;
      amapRef.current = AMap;
      current = new AMap.Map(elementRef.current, { center: [114.06, 22.55], zoom: 11, resizeEnable: true });
      mapRef.current = current;
      current.on("click", (event) => {
        // 选点模式：点在哪儿取哪儿。平时：点地图空白处 = 收起标记卡片。
        // 高德的标记点击不会冒泡到这里，所以点标记不会顺手把卡片关掉。
        if (!pickModeRef.current) { blankRef.current?.(); return; }
        const [lat, lng] = gcjToWgs(event.lnglat.getLat(), event.lnglat.getLng());
        pickRef.current?.({ lat, lng });
      });
      setReady(true);
    }).catch(() => { if (!cancelled) onError?.(); });
    return () => { cancelled = true; current?.destroy(); mapRef.current = null; amapRef.current = null; setReady(false); };
  }, [apiKey, useProxy, onError]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!ready || !map || !AMap) return;
    map.remove(markersRef.current);
    const markers = places.map((place) => {
      const [lat, lng] = wgsToGcj(place.lat, place.lng);
      const pin = document.createElement("span");
      pin.className = `amap-food-pin${place.id === selectedId ? " selected" : ""}`;
      pin.style.setProperty("--pin-color", normalizeColor(place.color));
      pin.title = place.name;
      const marker = new AMap.Marker({ position: [lng, lat], content: pin, anchor: "bottom-center" });
      marker.on("click", () => selectRef.current?.(place.id));
      return marker;
    });
    if (picked) {
      const [lat, lng] = wgsToGcj(picked.lat, picked.lng);
      const pin = document.createElement("span");
      pin.className = "amap-food-pin selected";
      markers.push(new AMap.Marker({ position: [lng, lat], content: pin, anchor: "bottom-center" }));
      map.setCenter([lng, lat]);
      map.setZoom(15);
    } else if (focusId) {
      // 详情页「在地图中查看」跳过来的定位：居中并放大到该点，
      // 省掉用户在整张图上自己找它的那一步。
      const target = places.find((place) => place.id === focusId);
      if (target) { const [lat, lng] = wgsToGcj(target.lat, target.lng); map.setCenter([lng, lat]); map.setZoom(Math.max(map.getZoom(), 16)); }
    } else if (selectedId) {
      const selected = places.find((place) => place.id === selectedId);
      if (selected) { const [lat, lng] = wgsToGcj(selected.lat, selected.lng); map.setCenter([lng, lat]); }
    } else if (!initialFitRef.current && places.length) {
      initialFitRef.current = true;
      const lat = places.reduce((sum, place) => sum + place.lat, 0) / places.length;
      const lng = places.reduce((sum, place) => sum + place.lng, 0) / places.length;
      const [gcjLat, gcjLng] = wgsToGcj(lat, lng);
      map.setCenter([gcjLng, gcjLat]);
      map.setZoom(places.length === 1 ? 14 : 11);
    }
    map.add(markers);
    markersRef.current = markers;
  }, [ready, places, selectedId, focusId, picked]);

  return <div ref={elementRef} className={`map-canvas amap-canvas ${pickMode ? "map-canvas-pick" : ""} ${className}`} aria-label={pickMode ? "点按地图选择地点位置" : "地点地图"} />;
}
