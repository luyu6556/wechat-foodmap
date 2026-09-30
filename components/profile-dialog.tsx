"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { api, jsonBody } from "../lib/client-api";
import { MEMBER_COLORS, contrastText, memberColorStyle, normalizeColor } from "../lib/color";
import type { Member } from "./types";

type Props = {
  current: Member | null;
  onClose?: () => void;
  onSaved: (member: Member) => void;
};

export default function ProfileDialog({ current, onClose, onSaved }: Props) {
  const [name, setName] = useState(current?.name || "");
  const [color, setColor] = useState(current ? normalizeColor(current.color) : MEMBER_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ownerCode, setOwnerCode] = useState("");

  async function save() {
    if (!name.trim()) { setError("先写一个昵称吧"); return; }
    setBusy(true);
    setError("");
    try {
      if (current) {
        const result = await api<{ member: Member }>("/api/me", { method: "PATCH", body: jsonBody({ name, color }) });
        onSaved(result.member);
      } else {
        const result = await api<{ member: Member; token: string }>("/api/members", { method: "POST", body: jsonBody({ name, color }) });
        localStorage.setItem("food-map-token", result.token);
        onSaved(result.member);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function claimOwner() {
    if (!ownerCode.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ member: Member }>("/api/owner/claim", { method: "POST", body: jsonBody({ code: ownerCode }) });
      setOwnerCode("");
      onSaved(result.member);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "验证失败");
    } finally { setBusy(false); }
  }

  return <div className="dialog-backdrop" role="presentation">
    <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      {onClose && <button className="icon-button dialog-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>}
      <div className="profile-illustration"><span style={memberColorStyle(color)}>{name.trim().slice(0, 1) || "你"}</span></div>
      <p className="eyebrow">加入这张地图</p>
      <h2 id="profile-title">大家怎么称呼你？</h2>
      <p className="dialog-intro">昵称和颜色会显示在你添加的地点、照片和评论旁。</p>
      <label className="field-label" htmlFor="member-name">你的昵称</label>
      <input id="member-name" className="text-field" value={name} maxLength={24} autoFocus
        onChange={(event) => setName(event.target.value)} placeholder="例如：小鹿" onKeyDown={(event) => { if (event.key === "Enter") void save(); }} />
      <span className="field-label color-label">选一个代表你的颜色</span>
      <div className="color-grid" role="group" aria-label="选择颜色">
        {MEMBER_COLORS.map((option) => <button key={option} type="button" className={`color-option ${color === option ? "active" : ""}`}
          style={{ background: option, color: contrastText(option) }} onClick={() => setColor(option)} aria-label={`颜色 ${option}`} aria-pressed={color === option}>
          {color === option && <Check size={18} strokeWidth={3} />}
        </button>)}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button full" onClick={() => void save()} disabled={busy}>{busy ? "保存中…" : current ? "保存修改" : "进入地图"}</button>
      {current && <details className="owner-claim">
        <summary>{current.isOwner ? "你是群主" : "我是群主"}</summary>
        {!current.isOwner && <div className="owner-claim-form">
          <input className="text-field" type="password" value={ownerCode} onChange={(event) => setOwnerCode(event.target.value)} placeholder="输入群主口令" aria-label="群主口令" />
          <button className="secondary-button" type="button" onClick={() => void claimOwner()} disabled={!ownerCode.trim() || busy}>验证</button>
        </div>}
      </details>}
    </section>
  </div>;
}
