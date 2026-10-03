"use client";

import { useMemo, useState } from "react";
import { Check, Clipboard, ExternalLink, Share2, X } from "lucide-react";
import { api, jsonBody } from "../lib/client-api";
import { memberColorStyle } from "../lib/color";
import { buildPollResultText } from "../lib/poll-text";
import SharedMap from "./shared-map";
import type { MapPlace } from "./map-canvas";
import type { PollDetail as PollDetailData } from "./types";

type Props = {
  detail: PollDetailData;
  onChanged: () => Promise<void>;
  onClosed: () => Promise<void>;
  onToast: (message: string) => void;
  onOpenPlace: (id: string) => void;
};

async function copy(value: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return true; } catch { /* Try the local fallback. */ }
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

export default function PollDetail({ detail, onChanged, onClosed, onToast, onOpenPlace }: Props) {
  const [pendingPlaceId, setPendingPlaceId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manualCopy, setManualCopy] = useState("");
  // 图钉高亮的那一项。编号＝列表序号，点图钉就滚到对应卡片。
  const [focusedPlaceId, setFocusedPlaceId] = useState<string | null>(null);
  const { poll, options, my, notVoted, totalMembers } = detail;
  const totalVotes = options.reduce((sum, option) => sum + option.count, 0);
  const highest = Math.max(0, ...options.map((option) => option.count));
  const leaders = highest ? options.filter((option) => option.count === highest) : [];
  const open = poll.status === "open";

  // 地图上的点：编号跟着完整列表走（第 1 项就是 1 号），已从地图删除的没有坐标、不画。
  const mapPlaces = useMemo(() => {
    const points: MapPlace[] = [];
    options.forEach((option, index) => {
      if (option.lat == null || option.lng == null) return;
      points.push({ id: option.placeId, name: option.name, lat: option.lat, lng: option.lng, label: String(index + 1) });
    });
    return points;
  }, [options]);
  const missingCoordinates = options.length - mapPlaces.length;

  function focusOption(placeId: string) {
    setFocusedPlaceId(placeId);
    document.getElementById(`poll-option-${placeId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function select(placeId: string) {
    setPendingPlaceId(placeId);
    setDraftNote(my?.placeId === placeId ? my.note : "");
    setError("");
  }

  async function cast(placeId: string | null) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await api(`/api/polls/${poll.id}/votes`, { method: "POST", body: jsonBody({ placeId, note: placeId ? draftNote : "" }) });
      setPendingPlaceId(null);
      setDraftNote("");
      await onChanged();
      onToast(placeId ? "投票已记录" : "已撤回投票");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "投票失败");
      await onChanged();
    } finally { setBusy(false); }
  }

  async function closePoll() {
    if (busy || !window.confirm("结束后所有人都不能再投，结果会保留在历史里。确定结束？")) return;
    setBusy(true); setError("");
    try {
      await api(`/api/polls/${poll.id}`, { method: "PATCH", body: jsonBody({ status: "closed" }) });
      await onClosed();
      onToast("投票已结束，结果保留在历史里");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "结束失败");
      await onChanged();
    } finally { setBusy(false); }
  }

  async function copyResult() {
    const value = buildPollResultText(detail);
    if (await copy(value)) onToast("结果已复制，发到群里吧");
    else { setManualCopy(value); onToast("自动复制失败，请长按选中文本复制"); }
  }

  async function sharePoll() {
    const url = new URL("/", window.location.origin);
    url.searchParams.set("poll", poll.id);
    try {
      if (navigator.share) await navigator.share({ title: poll.title, url: url.href });
      else if (await copy(url.href)) onToast("投票链接已复制，发到群里吧");
      else { setManualCopy(url.href); onToast("自动复制失败，请长按选中链接复制"); }
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError("分享失败，请重试");
    }
  }

  return <article className="poll-detail">
    <div className="poll-heading">
      <span className={`poll-status ${open ? "is-open" : ""}`}>{open ? "进行中" : "已结束"}</span>
      <h2>{poll.title}</h2>
      <p>由 {poll.creatorName} 发起 · {new Date(poll.createdAt).toLocaleDateString("zh-CN")}</p>
      {!open && <p>由 {poll.closedByName || "群友"} 于 {new Date(poll.closedAt || poll.createdAt).toLocaleString("zh-CN")} 结束</p>}
    </div>

    <div className="poll-progress"><strong>已投 {totalVotes}/{totalMembers} 人</strong><span>每人选一家，结果公开可见</span></div>
    {!open && highest > 0 && <div className="poll-outcome" role="status">
      {leaders.length > 1 ? "平票，需要再商量" : `就这家：${leaders[0].name}`}
    </div>}
    {!open && highest === 0 && <div className="poll-outcome" role="status">本次投票无人投票</div>}

    {mapPlaces.length > 0 && <section className="poll-map" aria-label="候选地点分布">
      <div className="poll-map-head"><h3>候选分布</h3><span>编号与下面列表一致</span></div>
      <SharedMap places={mapPlaces} selectedId={focusedPlaceId} onSelect={focusOption}
        onBlankClick={() => setFocusedPlaceId(null)} className="poll-map-canvas" fitAll />
      {missingCoordinates > 0 && <p className="poll-map-note">{missingCoordinates} 个候选已从地图删除，取不到坐标，没有画在图上。</p>}
    </section>}

    <div className="poll-options">
      {options.map((option, index) => <section id={`poll-option-${option.placeId}`}
        className={`poll-option ${my?.placeId === option.placeId ? "is-mine" : ""}${focusedPlaceId === option.placeId ? " is-focused" : ""}`} key={option.placeId}>
        <div className="poll-option-title"><h3><span className="poll-option-number">{index + 1}</span>{option.name}</h3><strong>{option.count} 票</strong></div>
        {option.deleted && <span className="poll-deleted">已从地图删除</span>}
        <p className="poll-option-address">{option.address || "地址待补充"}</p>
        <div className="poll-option-meta">
          <span>{option.avgPrice == null ? "人均待补充" : `人均 ¥${option.avgPrice}`}</span>
          {option.cuisine && <span>{option.cuisine}</span>}
          {option.platformRating != null && <span>平台 {Number(option.platformRating).toFixed(1)}</span>}
          {option.averageRating != null && <span>群友 {Number(option.averageRating).toFixed(1)}</span>}
        </div>
        {!option.deleted && <button className="poll-place-link" onClick={() => onOpenPlace(option.placeId)}><ExternalLink size={16} />查看地点详情</button>}
        <div className="poll-bar" aria-label={`${option.name} ${option.count} 票`}><span style={{ width: highest ? `${option.count / highest * 100}%` : "0%" }} /></div>
        {option.votes.length > 0 && <div className="poll-voters">{option.votes.map((vote) => <div className="poll-voter" key={vote.memberId}>
          <span className="member-avatar" style={memberColorStyle(vote.memberColor)}>{vote.memberName.slice(0, 1) || "?"}</span>
          <span><strong>{vote.memberName}{vote.mine ? " · 我" : ""}</strong>{vote.note && <small>{vote.note}</small>}</span>
        </div>)}</div>}
        {open && <button className={`poll-vote-choice ${my?.placeId === option.placeId ? "is-selected" : ""}`}
          onClick={() => select(option.placeId)} disabled={busy} aria-pressed={my?.placeId === option.placeId}>
          {my?.placeId === option.placeId ? <><Check size={18} />我投了这家 · 修改理由</> : my ? "改投这家" : "投这家"}
        </button>}
        {open && pendingPlaceId === option.placeId && <div className="poll-reason">
          <label htmlFor={`poll-note-${option.placeId}`}>推荐理由（可选，最多 140 字）</label>
          <textarea id={`poll-note-${option.placeId}`} className="text-field" value={draftNote} maxLength={140}
            onChange={(event) => setDraftNote(event.target.value)} placeholder="为什么想去这家？" />
          <div><button className="primary-button" onClick={() => void cast(option.placeId)} disabled={busy}>{my ? "改投这家" : "投这家"}</button>
            <button className="secondary-button" onClick={() => setPendingPlaceId(null)} disabled={busy}>取消</button></div>
        </div>}
      </section>)}
    </div>

    <section className="poll-not-voted"><h3>还没投的成员</h3>
      {notVoted.length ? <div>{notVoted.map((person) => <span className="poll-member" key={person.id}>
        <span className="member-avatar" style={memberColorStyle(person.color)}>{person.name.slice(0, 1) || "?"}</span>{person.name}
      </span>)}</div> : <p>已注册成员都投了</p>}
    </section>
    <p className="poll-identity-note">一人一票按浏览器身份计算；清缓存或换设备会产生新身份。投票人与理由对持有链接的人可见。</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="poll-actions">
      {open && my && <button className="secondary-button" onClick={() => void cast(null)} disabled={busy}><X size={18} />撤回我的票</button>}
      <button className="primary-button" onClick={() => void copyResult()}><Clipboard size={18} />复制结果发到群里</button>
      <button className="secondary-button" onClick={() => void sharePoll()}><Share2 size={18} />分享投票链接</button>
      {open && <button className="poll-close-button" onClick={() => void closePoll()} disabled={busy}>结束投票</button>}
    </div>
    {manualCopy && <div className="poll-manual-copy" role="dialog" aria-label="手动复制内容">
      <button className="icon-button" onClick={() => setManualCopy("")} aria-label="关闭"><X size={20} /></button>
      <p>长按下面的文字并复制</p><textarea readOnly value={manualCopy} onFocus={(event) => event.currentTarget.select()} />
    </div>}
  </article>;
}
