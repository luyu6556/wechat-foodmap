"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPinned, Plus, Share2, Star, Users } from "lucide-react";
import { api } from "../lib/client-api";
import AddPlaceDialog from "./add-place-dialog";
import MapCanvas from "./shared-map";
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
  const [view, setView] = useState<"list" | "map">("list");
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
    const authFailed = new URLSearchParams(window.location.search).has("auth_error");
    if (authFailed) {
      history.replaceState(null, "", window.location.pathname);
      window.setTimeout(() => setToast("微信授权失败，请重试或先用昵称进入"), 0);
    }
    void (async () => {
      try {
        const status = await api<{ enabled: boolean }>("/api/auth/wechat/status");
        if (status.enabled && /MicroMessenger/i.test(navigator.userAgent) && !authFailed) {
          const current = await api<{ member: Member }>("/api/me").catch(() => null);
          if (!current?.member.wechatLinked) {
            const next = await api<{ url: string }>("/api/auth/wechat/start", { method: "POST" });
            window.location.assign(next.url);
            return;
          }
          setMember(current.member);
          if (!current.member.name) setProfileOpen(true);
        } else {
          const current = await api<{ member: Member }>("/api/me");
          setMember(current.member);
          if (!current.member.name) setProfileOpen(true);
        }
      } catch {
        if (!localStorage.getItem("food-map-token")) setProfileOpen(true);
        else {
          localStorage.removeItem("food-map-token");
          setProfileOpen(true);
        }
      } finally { setProfileChecked(true); }
    })();
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
      if (navigator.share) await navigator.share({ title: "群聊美食地图", url: window.location.href });
      else {
        await navigator.clipboard.writeText(window.location.href);
        setToast("链接已复制，发到群里吧");
      }
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setToast("分享失败，可复制浏览器地址");
    }
  }

  return <div className="app-shell new-app-shell">
    <header className="app-header compact-header">
      <h1>群聊美食地图</h1>
      <div className="header-actions">
        <button className="header-share" onClick={() => void share()} aria-label="分享群地图"><Share2 size={21} /></button>
        {profileChecked && <button className="profile-trigger" onClick={() => setProfileOpen(true)} aria-label="修改我的昵称和颜色">
          <span className="member-avatar" style={{ background: member?.color || "#E75B35" }}>{member?.name.slice(0, 1) || "你"}</span>
        </button>}
      </div>
    </header>

    <main className="collection-layout">
      <div className="view-switch" role="tablist" aria-label="浏览方式">
        <button role="tab" aria-selected={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}>列表</button>
        <button role="tab" aria-selected={view === "map"} className={view === "map" ? "active" : ""} onClick={() => setView("map")}>地图</button>
      </div>
      <div className="collection-filters" role="group" aria-label="筛选地点">
          {(["全部", "美食", "玩乐"] as const).map((option) => <button key={option} className={filter === option ? "active" : ""} onClick={() => setFilter(option)} aria-pressed={filter === option}>{option}</button>)}
      </div>
      {view === "list" ? <section className="collection-list" aria-label="群友收藏">
          <div className="collection-heading"><h2>群友收藏 <span>({shownPlaces.length})</span></h2></div>
          {error && <div className="list-error" role="alert">{error}<button onClick={() => void loadPlaces()}>重试</button></div>}
          {loading && !error && <p className="list-message">正在加载群友收藏…</p>}
          {!loading && !error && !shownPlaces.length && (places.length ? <p className="list-message">这个分类还没有地点</p> : <div className="empty-state">
            <img src="/food-empty.png" alt="一碗热腾腾的面" />
            <h2>第一站，交给你</h2>
            <p>把群里聊过的店和想去的地方收在这里。</p>
            <button className="primary-button" onClick={() => setAddOpen(true)}><Plus size={18} />添加第一个地点</button>
          </div>)}
          <div className="compact-place-list">{shownPlaces.map((place) => <button key={place.id} className="compact-place-row" onClick={() => openDetail(place.id)}>
            {place.coverPhotoId ? <img className="compact-place-cover" src={`/api/photos/${place.coverPhotoId}`} alt="" loading="lazy" />
              : <span className="compact-place-cover compact-place-placeholder"><MapPinned size={23} /></span>}
            <span className="compact-place-content"><strong>{place.name}</strong><span className="compact-place-address">{place.address || "查看地图位置"}</span>
              <span className="compact-place-meta"><Star size={14} fill="currentColor" />{place.averageRating ? Number(place.averageRating).toFixed(1) : "待评分"}<span className="meta-divider" /><Users size={14} />{place.visitsCount} 人去过</span>
              <span className="compact-place-creator"><span className="member-avatar" style={{ background: place.creatorColor }}>{place.creatorName.slice(0, 1) || "?"}</span>{place.creatorName} 添加</span></span>
          </button>)}</div>
      </section> : <section className="collection-map" aria-label="群友收藏地图">
        <MapCanvas places={shownPlaces.map((place) => ({ id: place.id, name: place.name, lat: place.lat, lng: place.lng, color: place.creatorColor }))} selectedId={selectedId} onSelect={openDetail} />
        {error && <div className="map-error" role="alert">{error}<button onClick={() => void loadPlaces()}>重试</button></div>}
      </section>}
    </main>

    <div className="sticky-add"><button className="primary-button" onClick={() => setAddOpen(true)}><Plus size={21} strokeWidth={2.5} />添加地点</button></div>

    {profileOpen && <ProfileDialog current={member} onClose={member?.name ? () => setProfileOpen(false) : undefined}
      onSaved={(next) => { setMember(next); setProfileOpen(false); void loadPlaces(); if (selectedId) void loadDetail(selectedId); }} />}
    {addOpen && <AddPlaceDialog onClose={() => setAddOpen(false)} onSaved={(id) => void savedPlace(id)} />}
    {selectedId && <PlaceDetail data={detail} loading={detailLoading} onClose={() => { setSelectedId(null); setDetail(null); }} onRefresh={refreshCurrent}
      onDeleted={async () => { setSelectedId(null); setDetail(null); await loadPlaces(); setToast("地点已删除"); }} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
