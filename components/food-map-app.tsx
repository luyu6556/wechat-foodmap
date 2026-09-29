"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Heart, MapPinned, Plus, Share2, Star, Users } from "lucide-react";
import { api } from "../lib/client-api";
import AddPlaceDialog from "./add-place-dialog";
import MapCanvas from "./map-canvas";
import PlaceDetail from "./place-detail";
import ProfileDialog from "./profile-dialog";
import type { Member, PlaceDetailData, PlaceSummary } from "./types";

export default function FoodMapApp() {
  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlaceDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filter, setFilter] = useState<"全部" | "美食" | "玩乐">("全部");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const loadPlaces = useCallback(async () => {
    try {
      const result = await api<{ places: PlaceSummary[] }>("/api/places");
      setPlaces(result.places || []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "地图暂时加载失败");
    } finally { setLoading(false); }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const result = await api<PlaceDetailData>(`/api/places/${id}`);
      setDetail(result);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "地点加载失败");
    } finally { setDetailLoading(false); }
  }, []);

  useEffect(() => {
    void api<{ places: PlaceSummary[] }>("/api/places").then((result) => {
      setPlaces(result.places || []);
      setError("");
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "地图暂时加载失败");
    }).finally(() => setLoading(false));
    const token = localStorage.getItem("food-map-token");
    if (!token) {
      queueMicrotask(() => { setProfileOpen(true); setProfileChecked(true); });
      return;
    }
    void api<{ member: Member }>("/api/me").then((result) => {
      setMember(result.member);
      setProfileChecked(true);
    }).catch(() => {
      localStorage.removeItem("food-map-token");
      setProfileOpen(true);
      setProfileChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const shownPlaces = useMemo(() => filter === "全部" ? places : places.filter((place) => place.category === filter), [places, filter]);

  function openDetail(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    void loadDetail(id);
  }

  async function refreshCurrent() {
    if (!selectedId) return;
    await Promise.all([loadPlaces(), loadDetail(selectedId)]);
  }

  async function savedPlace(id: string) {
    setAddOpen(false);
    await loadPlaces();
    openDetail(id);
    setToast("已收进群地图");
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast("链接已复制，发到群里吧");
    } catch {
      setToast("复制失败，可直接复制浏览器地址分享");
    }
  }

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><div className="brand-mark"><MapPinned size={23} strokeWidth={2.4} /></div><div><strong>群聊美食地图</strong><span>大家收藏的好地方</span></div></div>
      <div className="header-actions">
        <button className="header-share" onClick={() => void share()} aria-label="复制地图链接"><Share2 size={19} /><span>分享</span></button>
        {profileChecked && <button className="profile-trigger" onClick={() => setProfileOpen(true)} aria-label="修改我的昵称和颜色">
          <span className="member-avatar" style={{ background: member?.color || "#E75B35" }}>{member?.name.slice(0, 1) || "你"}</span>
          <span className="profile-trigger-name">{member?.name || "设置昵称"}</span>
        </button>}
      </div>
    </header>

    <main className="main-layout">
      <section className="map-panel" aria-label="地点地图">
        <MapCanvas places={shownPlaces.map((place) => ({ id: place.id, name: place.name, lat: place.lat, lng: place.lng, color: place.creatorColor }))}
          selectedId={selectedId} onSelect={openDetail} />
        <div className="map-overlay-top"><span>{places.length} 个地点，等你去发现</span></div>
        <button className="map-add-button" onClick={() => setAddOpen(true)}><Plus size={20} strokeWidth={2.8} />添加地点</button>
      </section>

      <section className="places-panel" aria-label="地点列表">
        <div className="places-heading">
          <div><p className="eyebrow">群友的收藏</p><h1>想吃想玩的地方 <span>{places.length}</span></h1></div>
          <button className="list-add-button" onClick={() => setAddOpen(true)}><Plus size={18} />添加</button>
        </div>
        <div className="filter-row" role="group" aria-label="筛选地点">
          {(["全部", "美食", "玩乐"] as const).map((option) => <button key={option} className={filter === option ? "active" : ""} onClick={() => setFilter(option)} aria-pressed={filter === option}>{option}</button>)}
        </div>
        <div className="places-list">
          {error && <div className="list-error" role="alert">{error}<button onClick={() => void loadPlaces()}>重试</button></div>}
          {loading && !error && <p className="list-message">正在加载群友收藏…</p>}
          {!loading && !error && !shownPlaces.length && (places.length ? <p className="list-message">这个分类还没有地点</p> : <div className="empty-state">
            <img src="/food-empty.png" alt="一碗热腾腾的面" />
            <h2>第一站，交给你</h2>
            <p>把群里聊过的店和想去的地方收在这里。</p>
            <button className="primary-button" onClick={() => setAddOpen(true)}><Plus size={18} />添加第一个地点</button>
          </div>)}
          {shownPlaces.map((place) => <button key={place.id} className={`place-row ${selectedId === place.id ? "selected" : ""}`} onClick={() => openDetail(place.id)}>
            {place.coverPhotoId ? <img className="place-cover" src={`/api/photos/${place.coverPhotoId}`} alt="" loading="lazy" />
              : <div className="place-cover place-cover-plain"><MapPinned size={28} /></div>}
            <span className="place-row-body"><span className="place-row-title">{place.name}</span><span className="place-row-address">{place.address || "查看地图位置"}</span>
              <span className="place-row-foot"><span className="category-label">{place.category}</span><span className="small-stat"><Star size={13} fill="currentColor" />{place.averageRating ? Number(place.averageRating).toFixed(1) : "待评分"}</span><span className="small-stat"><Users size={13} />{place.visitsCount} 去过</span></span>
            </span>
            <span className="place-row-like"><Heart size={15} />{place.likesCount}</span>
          </button>)}
        </div>
      </section>
    </main>

    {profileOpen && <ProfileDialog current={member} onClose={member ? () => setProfileOpen(false) : undefined}
      onSaved={(next) => { setMember(next); setProfileOpen(false); void loadPlaces(); if (selectedId) void loadDetail(selectedId); }} />}
    {addOpen && <AddPlaceDialog onClose={() => setAddOpen(false)} onSaved={(id) => void savedPlace(id)} />}
    {selectedId && <PlaceDetail data={detail} loading={detailLoading} onClose={() => { setSelectedId(null); setDetail(null); }} onRefresh={refreshCurrent} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
