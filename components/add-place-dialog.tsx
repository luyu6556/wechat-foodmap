"use client";

import { useState } from "react";
import { Crosshair, Link2, MapPin, Sparkles, X } from "lucide-react";
import { api, ApiError, jsonBody } from "../lib/client-api";
import MapCanvas from "./map-canvas";
import type { ResolvedPlace } from "./types";

type Props = { onClose: () => void; onSaved: (id: string) => void };

export default function AddPlaceDialog({ onClose, onSaved }: Props) {
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourcePlatform, setSourcePlatform] = useState("手动输入");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [category, setCategory] = useState<"美食" | "玩乐">("美食");
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);

  async function resolve() {
    if (!sourceText.trim()) { setError("先粘贴分享内容"); return; }
    setResolving(true);
    setError("");
    try {
      const result = await api<{ resolved: ResolvedPlace }>("/api/resolve", { method: "POST", body: jsonBody({ text: sourceText }) });
      const value = result.resolved;
      if (value.name) setName(value.name);
      if (value.address) setAddress(value.address);
      if (value.lat !== null && value.lng !== null) setPoint({ lat: value.lat, lng: value.lng });
      setSourceUrl(value.sourceUrl);
      setSourcePlatform(value.sourcePlatform);
      setNotice(value.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "识别失败");
    } finally {
      setResolving(false);
    }
  }

  function locate() {
    if (!navigator.geolocation) { setError("当前浏览器不支持定位，请点地图选位置"); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => { setPoint({ lat: position.coords.latitude, lng: position.coords.longitude }); setError(""); },
      () => setError("无法获取当前位置，请点地图选位置"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("请填写地点名称"); return; }
    if (!point) { setError("请点地图选择地点位置"); return; }
    setSaving(true);
    setError("");
    try {
      const result = await api<{ id: string }>("/api/places", {
        method: "POST",
        body: jsonBody({ name, address, category, lat: point.lat, lng: point.lng, sourceText, sourceUrl, sourcePlatform }),
      });
      onSaved(result.id);
    } catch (cause) {
      if (cause instanceof ApiError && cause.existingId) {
        onSaved(cause.existingId);
      } else {
        setError(cause instanceof Error ? cause.message : "保存失败");
      }
    } finally {
      setSaving(false);
    }
  }

  return <div className="dialog-backdrop add-backdrop" role="presentation">
    <section className="add-dialog" role="dialog" aria-modal="true" aria-labelledby="add-title">
      <header className="sheet-header">
        <div><p className="eyebrow">收进群地图</p><h2 id="add-title">添加地点</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={22} /></button>
      </header>
      <form onSubmit={(event) => void save(event)}>
        <div className="add-scroll">
          <div className="import-panel">
            <div className="section-heading"><Link2 size={19} /><strong>从分享内容导入</strong></div>
            <p>粘贴美团、大众点评或地图分享内容。没有链接也可以直接填写。</p>
            <textarea className="text-field share-field" value={sourceText} maxLength={3000}
              onChange={(event) => { setSourceText(event.target.value); setNotice(""); }}
              placeholder="在这里粘贴链接或分享文案…" rows={3} />
            <button type="button" className="secondary-button" onClick={() => void resolve()} disabled={resolving}>
              <Sparkles size={17} />{resolving ? "识别中…" : "识别分享内容"}
            </button>
            {notice && <p className="import-notice" role="status">{notice}</p>}
          </div>

          <div className="field-grid">
            <div className="field-block">
              <label className="field-label" htmlFor="place-name">地点名称 <span>*</span></label>
              <input className="text-field" id="place-name" value={name} maxLength={80}
                onChange={(event) => setName(event.target.value)} placeholder="店名或想去的地方" />
            </div>
            <div className="field-block">
              <label className="field-label" htmlFor="place-category">类型</label>
              <select className="text-field" id="place-category" value={category} onChange={(event) => setCategory(event.target.value as "美食" | "玩乐")}>
                <option value="美食">美食</option><option value="玩乐">玩乐</option>
              </select>
            </div>
          </div>
          <div className="field-block">
            <label className="field-label" htmlFor="place-address">地址</label>
            <input className="text-field" id="place-address" value={address} maxLength={200}
              onChange={(event) => setAddress(event.target.value)} placeholder="街道、商场或地标" />
          </div>
          <div className="location-heading">
            <div><span className="field-label">地图位置 <span>*</span></span><p>点按地图放置图钉</p></div>
            <button type="button" className="text-button" onClick={locate}><Crosshair size={17} />用当前位置</button>
          </div>
          <MapCanvas pickMode picked={point} onPick={setPoint} className="picker-map" />
          <div className="coordinate-row"><MapPin size={16} />{point ? `已选位置：${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "还没有选择位置"}</div>
          <details className="coordinate-manual">
            <summary>地图无法选点？手动输入坐标</summary>
            <div className="coordinate-inputs">
              <input className="text-field" type="number" step="any" aria-label="纬度" placeholder="纬度" value={point?.lat ?? ""}
                onChange={(event) => setPoint({ lat: Number(event.target.value), lng: point?.lng ?? 114.06 })} />
              <input className="text-field" type="number" step="any" aria-label="经度" placeholder="经度" value={point?.lng ?? ""}
                onChange={(event) => setPoint({ lat: point?.lat ?? 22.55, lng: Number(event.target.value) })} />
            </div>
          </details>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="sheet-footer"><button className="primary-button full" disabled={saving}>{saving ? "保存中…" : "保存到群地图"}</button></div>
      </form>
    </section>
  </div>;
}
