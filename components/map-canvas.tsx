"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { normalizeColor } from "../lib/color";

export type MapPlace = { id: string; name: string; lat: number; lng: number; color?: string };

type Props = {
  places?: MapPlace[];
  selectedId?: string | null;
  picked?: { lat: number; lng: number } | null;
  pickMode?: boolean;
  onSelect?: (id: string) => void;
  onPick?: (point: { lat: number; lng: number }) => void;
  className?: string;
};

export default function MapCanvas({ places = [], selectedId, picked, pickMode, onSelect, onPick, className = "" }: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const markersRef = useRef<Leaflet.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  const selectRef = useRef(onSelect);
  const pickModeRef = useRef(pickMode);
  const initialFitRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    pickRef.current = onPick;
    selectRef.current = onSelect;
    pickModeRef.current = pickMode;
  }, [onPick, onSelect, pickMode]);

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
      current.on("click", (event: Leaflet.LeafletMouseEvent) => {
        if (pickModeRef.current) pickRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng });
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
    else if (selectedId) {
      const selected = places.find((place) => place.id === selectedId);
      if (selected) map.panTo([selected.lat, selected.lng], { animate: true });
    } else if (!initialFitRef.current && places.length) {
      initialFitRef.current = true;
      if (places.length === 1) map.setView([places[0].lat, places[0].lng], 14);
      else map.fitBounds(L.latLngBounds(places.map((place) => [place.lat, place.lng])), { padding: [35, 35], maxZoom: 14 });
    }
  }, [ready, places, selectedId, picked]);

  return <div ref={elementRef} className={`map-canvas ${pickMode ? "map-canvas-pick" : ""} ${className}`} aria-label={pickMode ? "点按地图选择地点位置" : "地点地图"} />;
}
