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
function loadAmap(key: string) {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (!loader) loader = new Promise<AMapGlobal>((resolve, reject) => {
    window._AMapSecurityConfig = { serviceHost: `${window.location.origin}/api/map/_AMapService` };
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
  places?: MapPlace[];
  selectedId?: string | null;
  picked?: { lat: number; lng: number } | null;
  pickMode?: boolean;
  onSelect?: (id: string) => void;
  onPick?: (point: { lat: number; lng: number }) => void;
  onError?: () => void;
  className?: string;
};

export default function AmapCanvas({ apiKey, places = [], selectedId, picked, pickMode, onSelect, onPick, onError, className = "" }: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const amapRef = useRef<AMapGlobal | null>(null);
  const markersRef = useRef<AMapMarker[]>([]);
  const selectRef = useRef(onSelect);
  const pickRef = useRef(onPick);
  const pickModeRef = useRef(pickMode);
  const initialFitRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => { selectRef.current = onSelect; pickRef.current = onPick; pickModeRef.current = pickMode; }, [onSelect, onPick, pickMode]);
  useEffect(() => {
    let cancelled = false;
    let current: AMapMap | null = null;
    void loadAmap(apiKey).then((AMap) => {
      if (cancelled || !elementRef.current) return;
      amapRef.current = AMap;
      current = new AMap.Map(elementRef.current, { center: [114.06, 22.55], zoom: 11, resizeEnable: true });
      mapRef.current = current;
      current.on("click", (event) => {
        if (!pickModeRef.current) return;
        const [lat, lng] = gcjToWgs(event.lnglat.getLat(), event.lnglat.getLng());
        pickRef.current?.({ lat, lng });
      });
      setReady(true);
    }).catch(() => { if (!cancelled) onError?.(); });
    return () => { cancelled = true; current?.destroy(); mapRef.current = null; amapRef.current = null; setReady(false); };
  }, [apiKey, onError]);

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
  }, [ready, places, selectedId, picked]);

  return <div ref={elementRef} className={`map-canvas amap-canvas ${pickMode ? "map-canvas-pick" : ""} ${className}`} aria-label={pickMode ? "点按地图选择地点位置" : "地点地图"} />;
}
