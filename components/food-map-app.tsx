"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, MessageSquareMore, Share2, Star, Users, X } from "lucide-react";
import { api } from "../lib/client-api";
import { memberColorStyle } from "../lib/color";
import AddPlaceDialog from "./add-place-dialog";
import FeedbackDialog from "./feedback-dialog";
import MapCanvas from "./shared-map";
import PlaceDetail from "./place-detail";
import PollPanel from "./poll-panel";
import ProfileDialog from "./profile-dialog";
import type { Member, PlaceDetailData, PlaceSummary } from "./types";

export default function FoodMapApp() {
  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlaceDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // selectedId 同时驱动地图上的高亮，所以「关掉详情」不能顺手清掉它 ——
  // 否则从详情跳去地图时高亮和居中会一起丢。详情面板的开关单独用 detailOpen 管。
  const [detailOpen, setDetailOpen] = useState(false);
  // 值为「要在地图上定位的地点 id」，由详情页的「在地图中查看」写入。
  const [mapFocusId, setMapFocusId] = useState<string | null>(null);
  // 值为「地图底部小卡片正在展示的地点 id」。点地图标记时写入，点卡片或点地图空白处清掉。
  // 和 detailOpen 是两件事：卡片是地图上的轻量预览，详情才是完整面板。
  const [peekId, setPeekId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map" | "poll">("list");
  const [deepLinkPollId, setDeepLinkPollId] = useState<string | null>(null);
  const [pollRefreshNonce, setPollRefreshNonce] = useState(0);
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
    const url = new URL(window.location.href);
    const linkedPoll = url.searchParams.get("poll");
    const pollTimer = linkedPoll ? window.setTimeout(() => { setDeepLinkPollId(linkedPoll); setView("poll"); }, 0) : null;
    const authFailed = url.searchParams.has("auth_error");
    if (authFailed) {
      url.searchParams.delete("auth_error");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
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
    return () => { if (pollTimer !== null) window.clearTimeout(pollTimer); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const shownPlaces = useMemo(() => filter === "全部" ? places : places.filter((place) => place.category === filter), [places, filter]);
  // 卡片只在「地图 tab、有选中、且没开完整详情」时出现；详情一开就自动让位。
  // 用 places 而不是 shownPlaces 查，避免切换筛选时卡片凭空消失。
  const peekPlace = useMemo(() => (view === "map" && peekId && !detailOpen ? places.find((place) => place.id === peekId) ?? null : null), [view, peekId, detailOpen, places]);

  function openDetail(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setDetailOpen(true);
    void loadDetail(id);
  }

  // 点地图标记：只选中 + 弹底部卡片，不直接开完整详情（详情要再点一下卡片）。
  function showPeek(id: string) {
    setSelectedId(id);
    setPeekId(id);
    setDetailOpen(false);
  }

  // 点地图空白处、或卡片的 ×：收起卡片，并清掉选中态让标记回到未选样式。
  function clearPeek() {
    if (!peekId) return;
    setPeekId(null);
    setSelectedId(null);
    setDetail(null);
  }

  function switchView(next: "list" | "map" | "poll") {
    setView(next);
    if (next !== "poll") {
      setDeepLinkPollId(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("poll");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  // 详情页里的「在地图中查看」：不关掉选中态，只关详情面板，切到地图、
  // 把镜头拉到该点，并顺手弹出同一张小卡片，落点一致。
  function showOnMap() {
    if (!selectedId) return;
    switchView("map");
    setDetailOpen(false);
    setMapFocusId(selectedId);
    setPeekId(selectedId);
  }

  async function refreshCurrent() {
    if (!selectedId) return;
    await Promise.all([loadPlaces(), loadDetail(selectedId)]);
  }

  async function savedPlace(id: string) {
    setAddOpen(false);
    await loadPlaces();
    setPollRefreshNonce((current) => current + 1);
    openDetail(id);
    setToast("已收进群地图");
  }

  // 批量保存：只刷新列表并提示，**不关弹窗** —— 还有草稿没处理完时，关不关由弹窗自己决定。
  async function savedPlaces(ids: string[]) {
    await loadPlaces();
    setPollRefreshNonce((current) => current + 1);
    setToast(ids.length > 1 ? `已收进群地图 ${ids.length} 个地点` : "已收进群地图");
  }

  async function share() {
    try {
      const url = new URL("/", window.location.origin).href;
      if (navigator.share) await navigator.share({ title: "群聊美食地图", url });
      else {
        await navigator.clipboard.writeText(url);
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
        <button className="header-share" onClick={() => setFeedbackOpen(true)} aria-label="反馈问题或改进建议"><MessageSquareMore size={21} /></button>
        <button className="header-share" onClick={() => void share()} aria-label="分享群地图"><Share2 size={21} /></button>
        {profileChecked && <button className="profile-trigger" onClick={() => setProfileOpen(true)} aria-label="修改我的昵称和颜色">
          <span className="member-avatar" style={memberColorStyle(member?.color)}>{member?.name.slice(0, 1) || "你"}</span>
        </button>}
      </div>
    </header>

    <main className={`collection-layout${view === "poll" ? " is-poll" : ""}`}>
      <div className="view-switch" role="tablist" aria-label="浏览方式">
        <button role="tab" aria-selected={view === "list"} className={view === "list" ? "active" : ""} onClick={() => switchView("list")}>列表</button>
        <button role="tab" aria-selected={view === "map"} className={view === "map" ? "active" : ""} onClick={() => switchView("map")}>地图</button>
        <button role="tab" aria-selected={view === "poll"} className={view === "poll" ? "active" : ""} onClick={() => switchView("poll")}>投票</button>
      </div>
      {view !== "poll" && <div className="collection-filters" role="group" aria-label="筛选地点">
          {(["全部", "美食", "玩乐"] as const).map((option) => <button key={option} className={filter === option ? "active" : ""} onClick={() => setFilter(option)} aria-pressed={filter === option}>{option}</button>)}
      </div>}
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
            {place.coverPhotoId ? <img className="compact-place-cover" src={`/api/photos/${place.coverPhotoId}`} alt="" loading="lazy" /> : null}
            <span className="compact-place-content"><strong>{place.name}</strong><span className="compact-place-address">{place.cuisine ? `${place.cuisine} · ` : ""}{place.address || "查看地图位置"}</span>
              <span className="compact-place-meta"><Star size={14} fill="currentColor" />{place.averageRating ? Number(place.averageRating).toFixed(1) : "待评分"}<span className="meta-divider" /><Users size={14} />{place.visitsCount} 人去过{place.avgPrice != null && <><span className="meta-divider" />人均 ¥{place.avgPrice}</>}{place.platformRating != null && <><span className="meta-divider" />平台 {Number(place.platformRating).toFixed(1)}</>}</span>
              <span className="compact-place-creator"><span className="member-avatar" style={memberColorStyle(place.creatorColor)}>{place.creatorName.slice(0, 1) || "?"}</span>{place.creatorName} 添加</span></span>
          </button>)}</div>
      </section> : view === "map" ? <section className="collection-map" aria-label="群友收藏地图">
        <MapCanvas places={shownPlaces.map((place) => ({ id: place.id, name: place.name, lat: place.lat, lng: place.lng, color: place.creatorColor }))} selectedId={selectedId} focusId={mapFocusId} onSelect={showPeek} onBlankClick={clearPeek} />
        {peekPlace && <div className="map-peek" role="group" aria-label={`${peekPlace.name} 快捷卡片`}>
          <button type="button" className="map-peek-main" onClick={() => openDetail(peekPlace.id)}>
            <strong>{peekPlace.name}</strong>
            <span className="map-peek-address">{peekPlace.cuisine ? `${peekPlace.cuisine} · ` : ""}{peekPlace.address || "查看地图位置"}</span>
            <span className="map-peek-footer">
              <span className="compact-place-meta"><Star size={13} fill="currentColor" />{peekPlace.averageRating ? Number(peekPlace.averageRating).toFixed(1) : "待评分"}<span className="meta-divider" /><Users size={13} />{peekPlace.visitsCount} 人去过{peekPlace.avgPrice != null && <><span className="meta-divider" />人均 ¥{peekPlace.avgPrice}</>}{peekPlace.platformRating != null && <><span className="meta-divider" />平台 {Number(peekPlace.platformRating).toFixed(1)}</>}</span>
              <span className="compact-place-creator"><span className="member-avatar" style={memberColorStyle(peekPlace.creatorColor)}>{peekPlace.creatorName.slice(0, 1) || "?"}</span>{peekPlace.creatorName} 添加</span>
            </span>
          </button>
          <button type="button" className="map-peek-close" onClick={clearPeek} aria-label="收起卡片"><X size={19} /></button>
        </div>}
        {error && <div className="map-error" role="alert">{error}<button onClick={() => void loadPlaces()}>重试</button></div>}
      </section> : profileChecked && member?.name ? <PollPanel initialPollId={deepLinkPollId} refreshNonce={pollRefreshNonce}
        onToast={setToast} onOpenPlace={openDetail} onAddPlace={() => setAddOpen(true)} />
        : <p className="poll-empty-message">请先设置昵称，再进入投票</p>}
    </main>

    {view !== "poll" && <div className="sticky-add"><button className="primary-button" onClick={() => setAddOpen(true)}><Plus size={21} strokeWidth={2.5} />添加地点</button></div>}

    {profileOpen && <ProfileDialog current={member} onClose={member?.name ? () => setProfileOpen(false) : undefined}
      onSaved={(next) => { setMember(next); setProfileOpen(false); void loadPlaces(); if (selectedId) void loadDetail(selectedId); }} />}
    {addOpen && <AddPlaceDialog onClose={() => setAddOpen(false)} onSaved={(id) => void savedPlace(id)}
      onBatchSaved={(ids) => void savedPlaces(ids)} />}
    {feedbackOpen && <FeedbackDialog isOwner={!!member?.isOwner} onClose={() => setFeedbackOpen(false)} onToast={setToast} />}
    {selectedId && detailOpen && <PlaceDetail data={detail} loading={detailLoading} onClose={() => { setSelectedId(null); setDetail(null); setDetailOpen(false); }} onShowOnMap={showOnMap} onRefresh={refreshCurrent}
      onDeleted={async () => { setSelectedId(null); setDetail(null); setDetailOpen(false); await loadPlaces(); setPollRefreshNonce((current) => current + 1); setToast("地点已删除"); }} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
