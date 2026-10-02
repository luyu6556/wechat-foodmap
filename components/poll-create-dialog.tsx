"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { api, jsonBody } from "../lib/client-api";
import type { PollCandidate } from "./types";

type Props = { onClose: () => void; onCreated: (id: string) => Promise<void>; onAddPlace: () => void };
type CandidatePage = { places: PollCandidate[]; nextCursor: string | null };
const presets = ["今天吃什么", "周末去哪吃", "团建地点"];

export default function PollCreateDialog({ onClose, onCreated, onAddPlace }: Props) {
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const queryRef = useRef("");
  const [places, setPlaces] = useState<PollCandidate[]>([]);
  const [selected, setSelected] = useState<PollCandidate[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void api<CandidatePage>(`/api/polls/candidates?q=${encodeURIComponent(query)}`).then((page) => {
        if (!cancelled) { setPlaces(page.places); setNextCursor(page.nextCursor); setError(""); }
      }).catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "地点加载失败");
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  async function loadMore() {
    if (!nextCursor || loading) return;
    const requestedQuery = query;
    setLoading(true);
    try {
      const page = await api<CandidatePage>(`/api/polls/candidates?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(nextCursor)}`);
      if (queryRef.current === requestedQuery) {
        setPlaces((current) => [...current, ...page.places]);
        setNextCursor(page.nextCursor);
      }
    } catch (cause) { if (queryRef.current === requestedQuery) setError(cause instanceof Error ? cause.message : "地点加载失败"); }
    finally { if (queryRef.current === requestedQuery) setLoading(false); }
  }

  function toggle(place: PollCandidate) {
    setError("");
    if (selected.some((item) => item.id === place.id)) {
      setSelected((current) => current.filter((item) => item.id !== place.id));
    } else if (selected.length >= 8) {
      setError("候选最多 8 家");
    } else {
      setSelected((current) => [...current, place]);
    }
  }

  async function publish() {
    const cleaned = title.trim();
    if (!cleaned || Array.from(cleaned).length > 30) { setError("投票标题需要填写，且不超过 30 字"); return; }
    if (selected.length < 2 || selected.length > 8) { setError("候选需要 2 到 8 家"); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ id: string }>("/api/polls", {
        method: "POST", body: jsonBody({ title: cleaned, placeIds: selected.map((item) => item.id) }),
      });
      await onCreated(result.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发起失败"); }
    finally { setBusy(false); }
  }

  return <div className="dialog-backdrop" role="presentation">
    <section className="poll-create-dialog" role="dialog" aria-modal="true" aria-labelledby="poll-create-title">
      <div className="poll-create-head"><h2 id="poll-create-title">发起群内投票</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></div>
      <div className="poll-create-scroll">
        <label className="field-label" htmlFor="poll-title">这次想决定什么？</label>
        <input id="poll-title" className="text-field" value={title} maxLength={30} onChange={(event) => setTitle(event.target.value)} placeholder="例如：今晚去哪吃" />
        <div className="poll-presets">{presets.map((preset) => <button key={preset} type="button" onClick={() => setTitle(preset)}>{preset}</button>)}</div>
        <div className="poll-candidate-head"><h3>候选地点 <span>{selected.length}/8</span></h3><p>按勾选顺序展示，至少选 2 家</p></div>
        {selected.length > 0 && <ol className="poll-selected-list">{selected.map((place) => <li key={place.id}>{place.name}
          <button onClick={() => toggle(place)} aria-label={`移除 ${place.name}`}><X size={17} /></button></li>)}</ol>}
        <label className="poll-search"><Search size={18} /><input value={query} onChange={(event) => { queryRef.current = event.target.value; setQuery(event.target.value); }} placeholder="搜索店名或地址" aria-label="搜索候选地点" /></label>
        <div className="poll-candidate-list">
          {places.map((place) => {
            const checked = selected.some((item) => item.id === place.id);
            return <button type="button" className={`poll-candidate ${checked ? "is-selected" : ""}`} key={place.id}
              onClick={() => toggle(place)} aria-pressed={checked}>
              <span><strong>{place.name}</strong><small>{place.address || "地址待补充"}</small><small>{place.avgPrice == null ? "人均待补充" : `人均 ¥${place.avgPrice}`}</small></span>
              <span className="poll-check">{checked ? "已选" : "选择"}</span>
            </button>;
          })}
          {!loading && !places.length && <p className="poll-empty-message">地点库中没有匹配的地点</p>}
          {nextCursor && <button className="poll-load-more" onClick={() => void loadMore()} disabled={loading}>加载更多地点</button>}
          {loading && <p className="poll-empty-message">正在加载地点…</p>}
        </div>
        <button className="poll-add-place-link" onClick={onAddPlace}><Plus size={18} />没有想选的店？先添加地点</button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="poll-create-footer"><button className="primary-button" onClick={() => void publish()} disabled={busy}>{busy ? "发布中…" : "发布投票"}</button></div>
    </section>
  </div>;
}
