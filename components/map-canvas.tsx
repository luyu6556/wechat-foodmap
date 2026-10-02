"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { normalizeColor } from "../lib/color";

export type MapPlace = { id: string; name: string; lat: number; lng: number; color?: string };

type Props = {
  places?: MapPlace[];
  selectedId?: string | null;
  focusId?: string | null;
  picked?: { lat: number; lng: number } | null;
  onSelect?: (id: string) => void;
  onBlankClick?: () => void;
  className?: string;
};

export default function MapCanvas({ places = [], selectedId, focusId, picked, onSelect, onBlankClick, className = "" }: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const markersRef = useRef<Leaflet.LayerGroup | null>(null);
  const selectRef = useRef(onSelect);
  const blankRef = useRef(onBlankClick);
  const initialFitRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    selectRef.current = onSelect;
    blankRef.current = onBlankClick;
  }, [onSelect, onBlankClick]);

  useEffect(() => {
    let cancelled = false;
    let current: Leaflet.Map | null = null;
    void import("leaflet").then((L) => {
      if (cancelled || !elementRef.current) return;
      leafletRef.current = L;
      current = L.map(elementRef.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        tapHold: false,
      }).setView([22.55, 114.06], 11);
      mapRef.current = current;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
      }).addTo(current);
      L.control.zoom({ position: "bottomright" }).addTo(current);
      markersRef.current = L.layerGroup().addTo(current);
      current.on("click", () => {
        // 点地图空白处 = 收起标记卡片。Leaflet 的 marker 默认 bubblingMouseEvents:false，
        // 所以点标记不会把卡片关掉。这里不再有「点图取点」：图钉一律由地址反查得出。
        blankRef.current?.();
      });
      setReady(true);
      setTimeout(() => current?.invalidateSize(), 50);
    });
    return () => {
      cancelled = true;
      current?.remove();
      mapRef.current = null;
      markersRef.current = null;
      leafletRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || !leafletRef.current || !markersRef.current) return;
    const L = leafletRef.current;
    const map = mapRef.current;
    markersRef.current.clearLayers();
    places.forEach((place) => {
      const selected = place.id === selectedId;
      const color = normalizeColor(place.color);
      const icon = L.divIcon({
        className: "food-map-marker-wrap",
        html: `<span class="food-map-marker${selected ? " is-selected" : ""}" style="--pin-color:${color}"><span></span></span>`,
        iconSize: [36, 42],
        iconAnchor: [18, 39],
      });
      L.marker([place.lat, place.lng], { icon, title: place.name })
        .on("click", () => selectRef.current?.(place.id))
        .addTo(markersRef.current!);
    });
    if (picked) {
      const icon = L.divIcon({
        className: "food-map-marker-wrap",
        html: '<span class="food-map-marker is-picked"><span></span></span>',
        iconSize: [36, 42], iconAnchor: [18, 39],
      });
      L.marker([picked.lat, picked.lng], { icon, interactive: false }).addTo(markersRef.current);
    }
    if (picked) map.setView([picked.lat, picked.lng], Math.max(map.getZoom(), 15), { animate: true });
    else if (focusId) {
      // 详情页「在地图中查看」跳过来的定位：居中并放大到该点。
      const target = places.find((place) => place.id === focusId);
      if (target) map.setView([target.lat, target.lng], Math.max(map.getZoom(), 16), { animate: true });
    } else if (selectedId) {
      const selected = places.find((place) => place.id === selectedId);
      if (selected) map.panTo([selected.lat, selected.lng], { animate: true });
    } else if (!initialFitRef.current && places.length) {
      initialFitRef.current = true;
      if (places.length === 1) map.setView([places[0].lat, places[0].lng], 14);
      else map.fitBounds(L.latLngBounds(places.map((place) => [place.lat, place.lng])), { padding: [35, 35], maxZoom: 14 });
    }
  }, [ready, places, selectedId, focusId, picked]);

  return <div ref={elementRef} className={`map-canvas ${className}`} aria-label="地点地图" />;
}
