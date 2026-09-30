"use client";

import { useEffect, useState } from "react";
import { Crosshair, ImageUp, Link2, MapPin, Sparkles, X } from "lucide-react";
import { api, ApiError, jsonBody } from "../lib/client-api";
import { preparePhoto } from "../lib/image-compress";
import MapCanvas from "./shared-map";
import type { LocatedPlace, RecognizedPlace, ResolvedPlace } from "./types";

type EditablePlace = {
  id: string; name: string; address: string; category: "美食" | "玩乐"; lat: number; lng: number;
  cuisine?: string;
  platformRating?: number | null;
  ratingCount?: number | null;
  avgPrice?: number | null;
};
type Props = { onClose: () => void; onSaved: (id: string) => void; initial?: EditablePlace };

function readable(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("图片读取失败")); else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export default function AddPlaceDialog({ onClose, onSaved, initial }: Props) {
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourcePlatform, setSourcePlatform] = useState("手动输入");
  const [name, setName] = useState(initial?.name || "");
  const [address, setAddress] = useState(initial?.address || "");
  const [category, setCategory] = useState<"美食" | "玩乐">(initial?.category || "美食");
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(initial ? { lat: initial.lat, lng: initial.lng } : null);
  // Numeric fields are kept as strings so the inputs stay controlled and a blank box is
  // distinguishable from zero; the server normalises them on save.
  const [cuisine, setCuisine] = useState(initial?.cuisine || "");
  const [platformRating, setPlatformRating] = useState(initial?.platformRating != null ? String(initial.platformRating) : "");
  const [ratingCount, setRatingCount] = useState(initial?.ratingCount != null ? String(initial.ratingCount) : "");
  const [avgPrice, setAvgPrice] = useState(initial?.avgPrice != null ? String(initial.avgPrice) : "");
  const [recognizedRaw, setRecognizedRaw] = useState("");
  const [shotPreview, setShotPreview] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => { if (shotPreview) URL.revokeObjectURL(shotPreview); }, [shotPreview]);

  function applyRecognized(value: RecognizedPlace) {
    if (value.name) setName(value.name);
    if (value.address) setAddress(value.address);
    setCuisine(value.cuisine);
    setPlatformRating(value.platformRating != null ? String(value.platformRating) : "");
    setRatingCount(value.ratingCount != null ? String(value.ratingCount) : "");
    setAvgPrice(value.avgPrice != null ? String(value.avgPrice) : "");
    setRecognizedRaw(value.rawText);
    setSourcePlatform("截图识别");
    setNotice(value.message);
  }

  // A screenshot never carries coordinates, so the pin has to come from a name/address
  // lookup. Returns the notice text so the caller can report what happened.
  async function autoLocate(look: { name: string; address: string; city?: string }) {
    if (!look.name && !look.address) return "";
    setLocating(true);
    try {
      const result = await api<{ located: LocatedPlace }>("/api/geocode", {
        method: "POST",
        body: jsonBody({ name: look.name, address: look.address, city: look.city || "" }),
      });
      const value = result.located;
      if (value.lat !== null && value.lng !== null) {
        setPoint({ lat: value.lat, lng: value.lng });
      }
      return value.message;
    } catch (cause) {
      return cause instanceof Error ? `${cause.message}，请在地图上点选位置。` : "自动定位失败，请在地图上点选位置。";
    } finally {
      setLocating(false);
    }
  }

  async function recognizeShot(file: File) {
    setRecognizing(true);
    setError("");
    try {
      const prepared = await preparePhoto(file);
      setShotPreview(URL.createObjectURL(prepared));
      const image = await readable(prepared);
      const result = await api<{ resolved: RecognizedPlace }>("/api/recognize", {
        method: "POST",
        body: jsonBody({ image }),
      });
      applyRecognized(result.resolved);
      const located = await autoLocate(result.resolved);
      setNotice(located ? `${result.resolved.message}${located}` : result.resolved.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "截图识别失败");
    } finally {
      setRecognizing(false);
    }
  }

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
      let message = value.message;
      // A 小程序 share gives a name but never a position; try to turn that name into a pin
      // so the member does not have to hunt for the shop on the map by hand.
      if (value.lat === null && value.lng === null) {
        const located = await autoLocate({ name: value.name, address: value.address });
        if (located) message = `${message}${located}`;
      }
      setNotice(message);
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
      const result = await api<{ id?: string }>(initial ? `/api/places/${initial.id}` : "/api/places", {
        method: initial ? "PATCH" : "POST",
        body: jsonBody({
          name, address, category, lat: point.lat, lng: point.lng, sourceText, sourceUrl, sourcePlatform,
          cuisine, platformRating, ratingCount, avgPrice, sourceRaw: recognizedRaw,
        }),
      });
      const savedId = result.id || initial?.id;
      if (!savedId) throw new Error("保存成功，但没有返回地点编号，请刷新页面查看");
      onSaved(savedId);
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

  const busy = saving || resolving || recognizing || locating;

  return <div className="dialog-backdrop add-backdrop" role="presentation">
    <section className="add-dialog" role="dialog" aria-modal="true" aria-labelledby="add-title">
      <header className="sheet-header">
        <div><h2 id="add-title">{initial ? "编辑地点" : "添加地点"}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={22} /></button>
      </header>
      <form onSubmit={(event) => void save(event)}>
        <div className="add-scroll">
          {!initial && <div className="import-panel">
            <div className="section-heading"><Link2 size={19} /><strong>从分享内容导入</strong></div>
            <p>粘贴美团、大众点评或地图分享内容；小程序口令识别不出店名时，改用截图识别。都没有也可以直接填写。</p>
            <textarea className="text-field share-field" value={sourceText} maxLength={3000}
              onChange={(event) => { setSourceText(event.target.value); setNotice(""); }}
              placeholder="在这里粘贴链接或分享文案…" rows={3} />
            <button type="button" className="secondary-button" onClick={() => void resolve()} disabled={busy}>
              <Sparkles size={17} />{resolving ? "识别中…" : "识别分享内容"}
            </button>
            <div className="shot-row">
              <label className={`secondary-button shot-button ${busy ? "disabled" : ""}`}>
                <ImageUp size={17} />{recognizing ? "识别截图中…" : "上传截图识别"}
                <input type="file" accept="image/*" disabled={busy}
                  onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void recognizeShot(file); }} />
              </label>
              {/* 本地 object URL 预览，next/image 无法优化；与既有照片展示保持同一种做法 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {shotPreview && <img className="shot-preview" src={shotPreview} alt="待识别的截图" />}
            </div>
            {locating && <p className="import-notice" role="status">正在自动定位…</p>}
            {notice && <p className="import-notice" role="status">{notice}</p>}
            {recognizedRaw && <details className="source-note" open>
              <summary>核对截图识别到的原文</summary>
              <p>{recognizedRaw}</p>
            </details>}
          </div>}

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
          <div className="field-grid even">
            <div className="field-block">
              <label className="field-label" htmlFor="place-cuisine">菜系 / 品类</label>
              <input className="text-field" id="place-cuisine" value={cuisine} maxLength={20}
                onChange={(event) => setCuisine(event.target.value)} placeholder="例如 新疆菜、东北家常菜" />
            </div>
            <div className="field-block">
              <label className="field-label" htmlFor="place-price">人均价格（元）</label>
              <input className="text-field" id="place-price" type="number" inputMode="numeric" min={0} value={avgPrice}
                onChange={(event) => setAvgPrice(event.target.value)} placeholder="截图里没有就留空" />
            </div>
          </div>
          <div className="field-grid even">
            <div className="field-block">
              <label className="field-label" htmlFor="place-rating">平台评分</label>
              <input className="text-field" id="place-rating" type="number" inputMode="decimal" step="0.1" min={0} max={5} value={platformRating}
                onChange={(event) => setPlatformRating(event.target.value)} placeholder="0–5，没有就留空" />
            </div>
            <div className="field-block">
              <label className="field-label" htmlFor="place-rating-count">评价条数</label>
              <input className="text-field" id="place-rating-count" type="number" inputMode="numeric" min={0} value={ratingCount}
                onChange={(event) => setRatingCount(event.target.value)} placeholder="例如 2280" />
            </div>
          </div>
          <p className="field-hint">平台评分与人均来自美团／大众点评截图，会过时，和群里自己的评分是两回事。</p>
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
        <div className="sheet-footer"><button className="primary-button full" disabled={busy}>{saving ? "保存中…" : initial ? "保存修改" : "保存到群地图"}</button></div>
      </form>
    </section>
  </div>;
}
