"use client";

import { useState } from "react";
import { Camera, Check, Heart, MapPin, MoreHorizontal, Navigation, Star, Trash2, Users, X } from "lucide-react";
import { api, jsonBody } from "../lib/client-api";
import { preparePhoto } from "../lib/image-compress";
import AddPlaceDialog from "./add-place-dialog";
import type { PlaceDetailData } from "./types";

type Props = {
  data: PlaceDetailData | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onDeleted: () => Promise<void>;
};

function avatar(name: string, color: string, key?: string) {
  return <span key={key} className="member-avatar" style={{ background: color }} title={name}>{name.slice(0, 1) || "?"}</span>;
}

export default function PlaceDetail({ data, loading, onClose, onRefresh, onDeleted }: Props) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");

  async function deletePlace() {
    if (!data || !window.confirm(`永久删除“${data.place.name}”及其照片和评论？`)) return;
    setBusy("delete-place"); setError("");
    try {
      await api(`/api/places/${data.place.id}`, { method: "DELETE" });
      await onDeleted();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败"); }
    finally { setBusy(""); }
  }

  async function deletePhoto(id: string) {
    if (!window.confirm("永久删除这张照片？")) return;
    setBusy(`photo-${id}`); setError("");
    try { await api(`/api/photos/${id}`, { method: "DELETE" }); await onRefresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "删除照片失败"); }
    finally { setBusy(""); }
  }

  async function deleteComment(id: string) {
    if (!window.confirm("永久删除这条评论？")) return;
    setBusy(`comment-${id}`); setError("");
    try { await api(`/api/comments/${id}`, { method: "DELETE" }); await onRefresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "删除评论失败"); }
    finally { setBusy(""); }
  }

  async function saveCommentEdit(id: string) {
    if (!commentDraft.trim()) return;
    setBusy(`comment-${id}`); setError("");
    try {
      await api(`/api/comments/${id}`, { method: "PATCH", body: jsonBody({ body: commentDraft }) });
      setEditingComment(null);
      await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "修改评论失败"); }
    finally { setBusy(""); }
  }

  async function action(kind: "like" | "visit" | "rating", score?: number) {
    if (!data || busy) return;
    setBusy(kind);
    setError("");
    try {
      await api(`/api/places/${data.place.id}/actions`, { method: "POST", body: jsonBody({ action: kind, score }) });
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally { setBusy(""); }
  }

  async function sendComment(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !comment.trim() || busy) return;
    setBusy("comment");
    setError("");
    try {
      await api(`/api/places/${data.place.id}/comments`, { method: "POST", body: jsonBody({ body: comment }) });
      setComment("");
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "评论失败");
    } finally { setBusy(""); }
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!data || !file) return;
    setBusy("photo");
    setError("");
    try {
      const form = new FormData();
      form.append("photo", await preparePhoto(file));
      await api(`/api/places/${data.place.id}/photos`, { method: "POST", body: form });
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传失败");
    } finally {
      setBusy("");
      event.target.value = "";
    }
  }

  const place = data?.place;
  return <>
    <div className="detail-shade" onClick={onClose} />
    <section className="detail-panel" role="dialog" aria-modal="true" aria-label={place?.name || "地点详情"}>
      <div className="detail-scroll">
        <div className="detail-topline"><span className="detail-drag" /><div className="detail-top-actions">
          {data?.canManagePlace && <details className="manage-menu"><summary aria-label="管理地点"><MoreHorizontal size={22} /></summary><div>
            <button onClick={() => setEditOpen(true)}>编辑地点</button>
            <button className="danger" onClick={() => void deletePlace()}>删除地点</button>
          </div></details>}
          <button className="icon-button detail-close" onClick={onClose} aria-label="关闭"><X size={21} /></button>
        </div></div>
        {loading && !data ? <div className="detail-loading">正在打开地点…</div> : !place ? <div className="detail-loading">暂时无法打开这个地点</div> : <>
          {data.photos.length > 0 ? <div className="detail-photo-hero" onClick={() => setLightbox(data.photos[0].id)} role="button" tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter") setLightbox(data.photos[0].id); }}>
            <img src={`/api/photos/${data.photos[0].id}`} alt={`${place.name} 的照片`} />
            <span>{data.photos.length} 张照片</span>
          </div> : <div className="detail-photo-empty"><img src="/food-empty.png" alt="一碗热腾腾的面" /><span>还没有照片，来分享第一张</span></div>}

          <div className="detail-body">
            <div className="detail-category">{place.category}</div>
            <h2>{place.name}</h2>
            <p className="detail-address"><MapPin size={17} />{place.address || "尚未填写详细地址"}</p>
            {(place.cuisine || place.platformRating != null || place.avgPrice != null) && <div className="platform-strip">
              {place.cuisine && <span>菜系 <b>{place.cuisine}</b></span>}
              {place.platformRating != null && <span>平台评分 <b>{Number(place.platformRating).toFixed(1)}</b>{place.ratingCount ? ` · ${place.ratingCount} 条` : ""}</span>}
              {place.avgPrice != null && <span>人均 <b>¥{place.avgPrice}</b></span>}
            </div>}
            <div className="detail-links">
              <a href={`https://uri.amap.com/marker?position=${place.lng},${place.lat}&coordinate=wgs84&name=${encodeURIComponent(place.name)}&src=group-food-map&callnative=0`} target="_blank" rel="noopener noreferrer"><Navigation size={17} />地图查看</a>
              {place.sourceUrl && <a href={place.sourceUrl} target="_blank" rel="noopener noreferrer">查看{place.sourcePlatform}来源</a>}
            </div>
            {!place.sourceUrl && place.sourceText && <details className="source-note"><summary>查看{place.sourcePlatform}分享内容</summary><p>{place.sourceText}</p></details>}
            {place.sourceRaw && <details className="source-note"><summary>查看截图识别到的原文</summary><p>{place.sourceRaw}</p></details>}

            <div className="detail-stats">
              <div><strong>{place.averageRating ? Number(place.averageRating).toFixed(1) : "—"}</strong><span>群友评分 · {place.ratingsCount} 人</span></div>
              <div><strong>{place.visitsCount}</strong><span>人去过</span></div>
              <div><strong>{place.likesCount}</strong><span>人想去</span></div>
            </div>

            <div className="detail-actions">
              <button className={`action-pill ${data.my?.liked ? "active" : ""}`} onClick={() => void action("like")} disabled={!!busy} aria-pressed={!!data.my?.liked}>
                <Heart size={18} fill={data.my?.liked ? "currentColor" : "none"} />{data.my?.liked ? "已点赞" : "想去 / 点赞"}
              </button>
              <button className={`action-pill ${data.my?.visited ? "active" : ""}`} onClick={() => void action("visit")} disabled={!!busy} aria-pressed={!!data.my?.visited}>
                <Check size={19} />{data.my?.visited ? "我去过了" : "标记去过"}
              </button>
            </div>

            <section className="detail-section rating-section">
              <h3>你给这里打几分？</h3>
              <div className="rating-row" role="group" aria-label="给地点评分">
                {[1, 2, 3, 4, 5].map((score) => <button key={score} className={score <= (data.my?.rating || 0) ? "selected" : ""}
                  onClick={() => void action("rating", score)} disabled={!!busy} aria-label={`${score} 星`} aria-pressed={data.my?.rating === score}>
                  <Star size={29} fill={score <= (data.my?.rating || 0) ? "currentColor" : "none"} />
                </button>)}
                <span>{data.my?.rating ? `我的评分 ${data.my.rating} 星` : "点星星评分"}</span>
              </div>
            </section>

            <section className="detail-section">
              <div className="section-title-row"><h3>谁去过</h3><Users size={18} /></div>
              {data.visitors.length ? <div className="visitors-list">{data.visitors.map((member) => <div key={member.id} className="visitor">{avatar(member.name, member.color)}<span>{member.name}</span></div>)}</div>
                : <p className="muted-copy">还没有人标记去过</p>}
            </section>

            <section className="detail-section">
              <div className="section-title-row"><h3>群友照片</h3><label className="upload-button"><Camera size={18} />{busy === "photo" ? "上传中…" : "上传照片"}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => void upload(event)} disabled={!!busy} /></label></div>
              {data.photos.length ? <div className="photo-grid">{data.photos.map((photo) => <div className="photo-cell" key={photo.id}><button onClick={() => setLightbox(photo.id)} aria-label={`查看 ${photo.memberName} 上传的照片`}>
                <img src={`/api/photos/${photo.id}`} alt={`${photo.memberName} 上传的地点照片`} loading="lazy" />
              </button>{photo.canManage && <button className="photo-delete" onClick={() => void deletePhoto(photo.id)} aria-label="删除照片" disabled={!!busy}><Trash2 size={15} /></button>}</div>)}</div> : <p className="muted-copy">拍过这里？上传一张给大家看看。</p>}
            </section>

            <section className="detail-section comments-section">
              <h3>评论 · {data.comments.length}</h3>
              <form className="comment-form" onSubmit={(event) => void sendComment(event)}>
                <input className="text-field" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} placeholder="聊聊这家店…" aria-label="评论内容" />
                <button className="primary-button" disabled={!comment.trim() || !!busy}>发送</button>
              </form>
              {data.comments.length ? <div className="comment-list">{data.comments.map((item) => <article key={item.id} className="comment-item">
                {avatar(item.memberName, item.memberColor)}
                <div><div className="comment-meta"><strong>{item.memberName}</strong><time>{new Date(item.createdAt).toLocaleDateString("zh-CN")}</time></div>
                  {editingComment === item.id ? <div className="comment-edit"><input className="text-field" value={commentDraft} maxLength={500} onChange={(event) => setCommentDraft(event.target.value)} aria-label="修改评论" /><button onClick={() => void saveCommentEdit(item.id)} disabled={!commentDraft.trim() || !!busy}>保存</button><button onClick={() => setEditingComment(null)}>取消</button></div> : <p>{item.body}</p>}
                  {item.canManage && editingComment !== item.id && <div className="comment-controls"><button onClick={() => { setEditingComment(item.id); setCommentDraft(item.body); }}>编辑</button><button onClick={() => void deleteComment(item.id)} disabled={!!busy}>删除</button></div>}
                </div>
              </article>)}</div> : <p className="muted-copy">还没有评论，留下第一句吧。</p>}
            </section>
            {error && <p className="form-error" role="alert">{error}</p>}
            <p className="detail-credit">由 {place.creatorName} 添加到群地图</p>
          </div>
        </>}
      </div>
    </section>
    {lightbox && <div className="lightbox" role="dialog" aria-modal="true" aria-label="查看照片" onClick={() => setLightbox(null)}>
      <button className="lightbox-close" onClick={() => setLightbox(null)} aria-label="关闭照片"><X size={26} /></button>
      <img src={`/api/photos/${lightbox}`} alt="地点照片大图" onClick={(event) => event.stopPropagation()} />
    </div>}
    {editOpen && data && <AddPlaceDialog initial={data.place} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); void onRefresh(); }} />}
  </>;
}
