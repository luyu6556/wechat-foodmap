"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, History, Plus } from "lucide-react";
import { api } from "../lib/client-api";
import PollCreateDialog from "./poll-create-dialog";
import PollDetail from "./poll-detail";
import type { PollDetail as PollDetailData, PollList, PollSummary } from "./types";

type Props = {
  initialPollId: string | null;
  refreshNonce: number;
  onToast: (message: string) => void;
  onOpenPlace: (id: string) => void;
  onAddPlace: () => void;
};

function updatePollParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("poll", id);
  else url.searchParams.delete("poll");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function historyDescription(item: PollSummary) {
  if (!item.topOptions.length) return "无人投票";
  if (item.topOptions.length > 1) return `平票：${item.topOptions.map((option) => option.name).join("、")}`;
  return `最高票：${item.topOptions[0].name}`;
}

export default function PollPanel({ initialPollId, refreshNonce, onToast, onOpenPlace, onAddPlace }: Props) {
  const [list, setList] = useState<PollList | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const detailRequestRef = useRef(0);
  const [detail, setDetail] = useState<PollDetailData | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    const data = await api<PollList>("/api/polls");
    setList(data);
    return data;
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const requestNumber = ++detailRequestRef.current;
    try {
      const data = await api<PollDetailData>(`/api/polls/${encodeURIComponent(id)}`);
      if (selectedIdRef.current === id && detailRequestRef.current === requestNumber) { setDetail(data); setError(""); }
    } catch (cause) {
      if (selectedIdRef.current === id && detailRequestRef.current === requestNumber) setError(cause instanceof Error ? cause.message : "投票加载失败");
    } finally {
      if (selectedIdRef.current === id && detailRequestRef.current === requestNumber) setDetailLoading(false);
    }
  }, []);

  const openPoll = useCallback((id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setError("");
    updatePollParam(id);
    void loadDetail(id);
  }, [loadDetail]);

  useEffect(() => {
    let active = true;
    void api<PollList>("/api/polls").then((data) => {
      if (!active) return;
      setList(data);
      const target = initialPollId || data.open?.id;
      if (target) openPoll(target);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "投票加载失败");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [initialPollId, openPoll]);

  useEffect(() => {
    if (!refreshNonce) return;
    void api<PollList>("/api/polls").then(setList).catch(() => {});
    if (selectedIdRef.current) void loadDetail(selectedIdRef.current);
  }, [refreshNonce, loadDetail]);

  useEffect(() => {
    if (!selectedId || detail?.poll.status !== "open") return;
    let timer: number | null = null;
    const sync = () => {
      if (document.visibilityState === "visible") {
        if (timer === null) timer = window.setInterval(() => void loadDetail(selectedId), 10_000);
      } else if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      sync();
      if (document.visibilityState === "visible") void loadDetail(selectedId);
    };
    sync();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [selectedId, detail?.poll.status, loadDetail]);

  useEffect(() => {
    if (detail?.poll.status !== "closed" || list?.open?.id !== detail.poll.id) return;
    void api<PollList>("/api/polls").then((data) => { setList(data); setShowHistory(true); }).catch(() => {});
  }, [detail?.poll.id, detail?.poll.status, list?.open?.id]);

  useEffect(() => {
    if (selectedId || showHistory || !list || list.open) return;
    let timer: number | null = null;
    const refresh = () => {
      void api<PollList>("/api/polls").then((data) => {
        if (!selectedIdRef.current) {
          setList(data);
          if (data.open) openPoll(data.open.id);
        }
      }).catch(() => {});
    };
    const sync = () => {
      if (document.visibilityState === "visible" && timer === null) timer = window.setInterval(refresh, 10_000);
      else if (document.visibilityState !== "visible" && timer !== null) { window.clearInterval(timer); timer = null; }
    };
    const onVisibility = () => { sync(); if (document.visibilityState === "visible") refresh(); };
    sync();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { document.removeEventListener("visibilitychange", onVisibility); if (timer !== null) window.clearInterval(timer); };
  }, [selectedId, showHistory, list, openPoll]);

  async function loadMoreHistory() {
    if (!list?.nextCursor || historyLoading) return;
    setHistoryLoading(true);
    try {
      const page = await api<PollList>(`/api/polls?cursor=${encodeURIComponent(list.nextCursor)}`);
      setList((current) => current ? { ...current, open: page.open,
        history: [...current.history, ...page.history], nextCursor: page.nextCursor } : page);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "历史加载失败"); }
    finally { setHistoryLoading(false); }
  }

  function goHistory() {
    selectedIdRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setShowHistory(true);
    setError("");
    updatePollParam(null);
    void loadList().catch((cause) => setError(cause instanceof Error ? cause.message : "历史加载失败"));
  }

  function goActive() {
    setShowHistory(false);
    setError("");
    selectedIdRef.current = null;
    setSelectedId(null);
    setDetail(null);
    updatePollParam(null);
    void loadList().then((data) => { if (data.open) openPoll(data.open.id); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "投票加载失败"));
  }

  async function created(id: string) {
    setCreateOpen(false);
    setShowHistory(false);
    openPoll(id);
    void loadList().catch((cause) => setError(cause instanceof Error ? cause.message : "投票列表刷新失败"));
    onToast("投票已发布，分享链接邀请大家来选");
  }

  async function closed() {
    setShowHistory(true);
    void loadList().catch((cause) => setError(cause instanceof Error ? cause.message : "投票列表刷新失败"));
    if (selectedIdRef.current) await loadDetail(selectedIdRef.current);
  }

  return <section className="poll-panel" aria-label="群内投票">
    <div className="poll-panel-nav">
      {showHistory ? <button onClick={selectedId ? goHistory : goActive} className="poll-nav-button"><ArrowLeft size={18} />{selectedId ? "返回历史" : "进行中 / 发起投票"}</button>
        : <h2>群内投票</h2>}
      {!showHistory && <button onClick={goHistory} className="poll-nav-button"><History size={18} />历史投票</button>}
    </div>
    {loading && <p className="poll-empty-message">正在加载投票…</p>}
    {error && <div className="poll-panel-error" role="alert">{error}<button onClick={() => { void loadList(); if (selectedId) void loadDetail(selectedId); }}>重试</button></div>}
    {!loading && showHistory && !selectedId && <div className="poll-history">
      <div className="poll-history-head"><h2>历史投票</h2>{list?.open && <button className="secondary-button" onClick={goActive}>查看进行中</button>}</div>
      {list?.history.length ? list.history.map((item) => <button className="poll-history-row" key={item.id} onClick={() => openPoll(item.id)}>
        <strong>{item.title}</strong><span>{historyDescription(item)}</span>
        <small>{item.closedByName || "群友"}结束 · {new Date(item.closedAt || item.createdAt).toLocaleString("zh-CN")}</small>
      </button>) : <p className="poll-empty-message">还没有历史投票</p>}
      {list?.nextCursor && <button className="poll-load-more" onClick={() => void loadMoreHistory()} disabled={historyLoading}>{historyLoading ? "加载中…" : "加载更多历史"}</button>}
    </div>}
    {!loading && selectedId && list?.open?.id === selectedId && <div className="poll-create-blocked"><button disabled>发起投票</button><span>请先结束当前投票</span></div>}
    {!loading && selectedId && (detail ? <PollDetail key={detail.poll.id} detail={detail} onChanged={() => loadDetail(selectedId)}
      onClosed={closed} onToast={onToast} onOpenPlace={onOpenPlace} />
      : detailLoading ? <p className="poll-empty-message">正在打开投票…</p> : null)}
    {!loading && !showHistory && !selectedId && <div className="poll-empty-state">
      <span>🗳️</span><h2>这次去哪家？</h2>
      <p>从群地图里选几家候选，大家在这里投票，地址和人均都在手边。</p>
      <button className="primary-button" onClick={() => setCreateOpen(true)} disabled={!!list?.open}><Plus size={19} />发起投票</button>
      {list?.open && <p>请先结束当前投票</p>}
    </div>}
    {!loading && selectedId && list?.open && list.open.id !== selectedId && <p className="poll-current-link"><button onClick={goActive}>查看当前进行中的投票</button></p>}
    {createOpen && <PollCreateDialog onClose={() => setCreateOpen(false)} onCreated={created}
      onAddPlace={() => { setCreateOpen(false); onAddPlace(); }} />}
  </section>;
}
