"use client";

import { useEffect, useState } from "react";
import { Send, Trash2, X } from "lucide-react";
import { api, jsonBody } from "../lib/client-api";
import { memberColorStyle } from "../lib/color";
import type { FeedbackItem } from "./types";

type Props = {
  // 群主多看到一块「收到的反馈」；其他人只有提交表单。
  isOwner: boolean;
  onClose: () => void;
  onToast: (message: string) => void;
};

const MAX_LENGTH = 500;

// 只负责取数据，不碰 state —— 这样 effect 里调用它不会被
// react-hooks/set-state-in-effect 拦下（那条规则禁止在 effect 里同步 setState）。
const fetchInbox = () => api<{ items: FeedbackItem[] }>("/api/feedback").then((result) => result.items || []);

export default function FeedbackDialog({ isOwner, onClose, onToast }: Props) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    void fetchInbox().then((list) => { if (!cancelled) setItems(list); }).catch((cause) => {
      if (cancelled) return;
      setError(cause instanceof Error ? cause.message : "反馈加载失败");
      setItems([]);
    });
    return () => { cancelled = true; };
  }, [isOwner]);

  async function submit() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/feedback", { method: "POST", body: jsonBody({ body: text }) });
      onToast("已收到，谢谢");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交失败");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (deletingId || !window.confirm("删除这条反馈？删掉就找不回来了。")) return;
    setDeletingId(id);
    setError("");
    try {
      await api(`/api/feedback/${id}`, { method: "DELETE" });
      setItems((current) => current ? current.filter((item) => item.id !== id) : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
      // 没删成功，下面这份列表可能已经不准了，重新拉一次。
      void fetchInbox().then(setItems).catch(() => {});
    } finally { setDeletingId(null); }
  }

  return <div className="dialog-backdrop" role="presentation">
    <section className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <div className="feedback-head">
        <h2 id="feedback-title">反馈问题 / 改进建议</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
      </div>
      <div className="feedback-scroll">
        {isOwner && <section className="feedback-inbox" aria-label="收到的反馈">
          <div className="feedback-inbox-head">
            <h3>收到的反馈{items ? ` · ${items.length}` : ""}</h3>
            {items === null && <span>加载中…</span>}
          </div>
          {items?.length === 0 && <p className="feedback-empty">还没有人反馈过</p>}
          {items?.map((item) => <article className="feedback-item" key={item.id}>
            <span className="member-avatar" style={memberColorStyle(item.memberColor)}>{item.memberName.slice(0, 1) || "?"}</span>
            <div className="feedback-item-main">
              <span className="feedback-item-meta"><strong>{item.memberName || "群友"}</strong><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small></span>
              <p>{item.body}</p>
            </div>
            <button className="icon-button feedback-delete" onClick={() => void remove(item.id)}
              disabled={deletingId === item.id} aria-label={`删除 ${item.memberName || "群友"} 的反馈`}><Trash2 size={18} /></button>
          </article>)}
          <div className="feedback-divider"><span>我也要提一条</span></div>
        </section>}

        <p className="dialog-intro">用起来哪里别扭、哪里不对、想加什么功能，都写在下面。只有群主看得到。</p>
        <label className="field-label" htmlFor="feedback-body">写点什么</label>
        <textarea id="feedback-body" className="text-field" rows={5} maxLength={MAX_LENGTH} value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="例如：某家店的地址看不清 / 希望列表能按人均排序 / 手机上这个按钮太小" />
        <p className="feedback-count">{body.length}/{MAX_LENGTH}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="feedback-footer">
        <button className="primary-button" onClick={() => void submit()} disabled={busy || !body.trim()}>
          <Send size={18} />{busy ? "提交中…" : "提交"}
        </button>
      </div>
    </section>
  </div>;
}
