"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { api, jsonBody } from "../lib/client-api";
import type { Member } from "./types";

const colors = ["#E75B35", "#2D7A72", "#4169A8", "#9360A5", "#D58B26", "#C75574", "#41604D", "#3F5969"];

type Props = {
  current: Member | null;
  onClose?: () => void;
  onSaved: (member: Member) => void;
};

export default function ProfileDialog({ current, onClose, onSaved }: Props) {
  const [name, setName] = useState(current?.name || "");
  const [color, setColor] = useState(current?.color || colors[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  return <div className="dialog-backdrop" role="presentation">
    <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      {onClose && <button className="icon-button dialog-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>}
      <div className="profile-illustration"><span style={{ background: color }}>{name.trim().slice(0, 1) || "你"}</span></div>
      <p className="eyebrow">加入这张地图</p>
      <h2 id="profile-title">大家怎么称呼你？</h2>
      <p className="dialog-intro">昵称和颜色会显示在你添加的地点、照片和评论旁。</p>
      <label className="field-label" htmlFor="member-name">你的昵称</label>
      <input id="member-name" className="text-field" value={name} maxLength={24} autoFocus
        onChange={(event) => setName(event.target.value)} placeholder="例如：小鹿" onKeyDown={(event) => { if (event.key === "Enter") void save(); }} />
      <span className="field-label color-label">选一个代表你的颜色</span>
      <div className="color-grid" role="group" aria-label="选择颜色">
        {colors.map((option) => <button key={option} type="button" className={`color-option ${color === option ? "active" : ""}`}
          style={{ background: option }} onClick={() => setColor(option)} aria-label={`颜色 ${option}`} aria-pressed={color === option}>
          {color === option && <Check size={18} strokeWidth={3} />}
        </button>)}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button full" onClick={() => void save()} disabled={busy}>{busy ? "保存中…" : current ? "保存修改" : "进入地图"}</button>
    </section>
  </div>;
}
