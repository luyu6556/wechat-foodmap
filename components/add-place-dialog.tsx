"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, Crosshair, ImageUp, Link2, ListChecks, MapPin, MapPinned, Sparkles, X } from "lucide-react";
import { api, ApiError, jsonBody } from "../lib/client-api";
import { preparePhoto } from "../lib/image-compress";
import MapCanvas from "./shared-map";
import type { LocatedPlace, PlaceCandidate, RecognizedPlace, ResolvedPlace } from "./types";

// 一次最多几个待保存草稿（截图 + 分享文案合计）。超过就挡住，避免一口气灌进几十条。
const MAX_DRAFTS = 5;
// 视觉识别是一次模型调用：5 张串行太慢，5 张并发容易撞限流，取 2。
const RECOGNIZE_CONCURRENCY = 2;

type Category = "美食" | "玩乐";

type EditablePlace = {
  id: string; name: string; address: string; category: Category; lat: number; lng: number;
  recommendation?: string;
  cuisine?: string;
  platformRating?: number | null;
  ratingCount?: number | null;
  avgPrice?: number | null;
};

// 一条「待保存草稿」。识别、定位、保存都是逐条走的，所以状态也挂在条上 ——
// 不能再用一个全局的「识别中」布尔量，否则 5 条一起跑时看不出卡在哪一条。
type Draft = {
  key: string;
  preview: string | null;
  name: string; address: string; category: Category;
  // 添加者自己写的推荐理由，选填；识别永远产不出它。
  recommendation: string;
  cuisine: string; platformRating: string; ratingCount: string; avgPrice: string;
  lat: number | null; lng: number | null;
  sourceText: string; sourceUrl: string | null; sourcePlatform: string; rawText: string;
  stage: "" | "recognizing" | "locating" | "saving";
  message: string; error: string;
  // 保存时服务端判定「群里已经有一个」，记下来既能跳过、也能让用户看见原因。
  existingId: string | null;
  editingId: string | null;
  // 同品牌有多家门店时，服务端不替我们选，把候选交给用户挑 —— 选错分店的图钉和正确的长得一样。
  candidates: PlaceCandidate[];
};

type Props = {
  onClose: () => void;
  onSaved: (id: string) => void;
  // 批量保存成功后的回调：父层只刷新列表并提示，**不关弹窗**（草稿还没处理完时不能关）。
  onBatchSaved?: (ids: string[]) => void;
  initial?: EditablePlace;
};

let sequence = 0;
function nextKey() { sequence += 1; return `draft-${sequence}`; }

function blankDraft(patch: Partial<Draft> = {}): Draft {
  return {
    key: nextKey(), preview: null, name: "", address: "", category: "美食",
    recommendation: "",
    cuisine: "", platformRating: "", ratingCount: "", avgPrice: "",
    lat: null, lng: null, sourceText: "", sourceUrl: null, sourcePlatform: "手动输入",
    rawText: "", stage: "", message: "", error: "", existingId: null, editingId: null, candidates: [],
    ...patch,
  };
}

function draftFromInitial(initial: EditablePlace): Draft {
  return blankDraft({
    name: initial.name, address: initial.address, category: initial.category,
    lat: initial.lat, lng: initial.lng,
    recommendation: initial.recommendation || "",
    cuisine: initial.cuisine || "",
    platformRating: initial.platformRating != null ? String(initial.platformRating) : "",
    ratingCount: initial.ratingCount != null ? String(initial.ratingCount) : "",
    avgPrice: initial.avgPrice != null ? String(initial.avgPrice) : "",
    editingId: initial.id,
  });
}

// 「用户什么都没填过」的空草稿：粘贴分享内容时直接复用它，免得列表里先挂一个空行。
function isPristine(draft: Draft) {
  return draft.editingId === null && !draft.name && !draft.address && !draft.rawText
    && !draft.preview && !draft.sourceText && draft.lat === null;
}

function checkDraft(draft: Draft) {
  if (!draft.name.trim()) return "请填写地点名称";
  if (draft.lat === null || draft.lng === null) return "还没定位到，请用「用当前位置」或手动输入坐标";
  return "";
}

function draftStatus(draft: Draft): { text: string; tone: "muted" | "warn" | "ok" | "bad" } {
  if (draft.stage === "recognizing") return { text: "读图中…", tone: "muted" };
  if (draft.stage === "locating") return { text: "定位中…", tone: "muted" };
  if (draft.stage === "saving") return { text: "保存中…", tone: "muted" };
  if (draft.error) return { text: "这一步没成", tone: "bad" };
  if (draft.existingId) return { text: "群里已有", tone: "warn" };
  if (draft.candidates.length && (draft.lat === null || draft.lng === null)) return { text: "待选门店", tone: "warn" };
  // 「没读出内容」和「读出来了但没定位到」是两件事，提示语不能混：前者要人重传或手填，
  // 后者要靠「用当前位置」或手动坐标补一个位置。
  if (!draft.name.trim() && !draft.address.trim()) return { text: "没读出内容", tone: "warn" };
  if (draft.lat === null || draft.lng === null) return { text: "待定位", tone: "warn" };
  if (!draft.name.trim()) return { text: "缺名称", tone: "warn" };
  return { text: "可保存", tone: "ok" };
}

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

// 固定并发度的任务池：识别 5 张截图时用它把总时长压到约 3 张的耗时。
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  }));
}

export default function AddPlaceDialog({ onClose, onSaved, onBatchSaved, initial }: Props) {
  const canBatch = !initial;
  const [drafts, setDrafts] = useState<Draft[]>(() => (initial ? [draftFromInitial(initial)] : [blankDraft()]));
  // 用 key 记住当前编辑哪一条，而不是存下标 —— 删掉一条之后下标会串位。
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);

  // 只为草稿生成的本地预览图，卸载和删条时都要 revoke，否则一路泄漏。
  const previews = useRef(new Set<string>());

  const active = drafts.find((draft) => draft.key === activeKey) ?? drafts[0];
  const busy = saving || resolving || drafts.some((draft) => draft.stage !== "");
  const ready = drafts.filter((draft) => !checkDraft(draft) && !draft.existingId);
  // 真正「还没填完」的条数（不含已重复/已保存的），用来决定页脚那句提示。
  const unfinished = drafts.filter((draft) => Boolean(checkDraft(draft))).length;
  // 列表本来只在多条草稿时展开。但「群里已有」和「这一步没成」这两个徽标只长在列表
  // 条目上：批量保存后如果只剩一条重复、或单张截图识别失败，收起列表就等于把原因藏了。
  const showList = canBatch && (drafts.length > 1 || drafts.some((draft) => draft.existingId || draft.error));

  useEffect(() => () => {
    for (const url of previews.current) URL.revokeObjectURL(url);
    previews.current.clear();
  }, []);

  const updateDraft = useCallback((key: string, patch: Partial<Draft>) => {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  }, []);

  function dropPreview(url: string | null) {
    if (url && previews.current.has(url)) { URL.revokeObjectURL(url); previews.current.delete(url); }
  }

  function removeDraft(key: string) {
    if (drafts.length <= 1) return;
    dropPreview(drafts.find((draft) => draft.key === key)?.preview ?? null);
    setDrafts((current) => current.filter((draft) => draft.key !== key));
    if (activeKey === key) setActiveKey(null);
  }

  // 截图里没有坐标，图钉只能靠名称/地址反查。这是**唯一**会产出图钉的自动路径，
  // 用户不能点地图改标记 —— 反查不出来就只剩「用当前位置」和手动坐标两条兜底。
  // 返回提示文案，交给调用方拼进该条的说明。
  async function locateInto(key: string, look: { name: string; address: string }) {
    if (!look.name && !look.address) return "";
    updateDraft(key, { stage: "locating", error: "", candidates: [] });
    try {
      const result = await api<{ located: LocatedPlace }>("/api/geocode", {
        method: "POST",
        body: jsonBody({ name: look.name, address: look.address, city: "" }),
      });
      const value = result.located;
      if (value.lat !== null && value.lng !== null) {
        updateDraft(key, { lat: value.lat, lng: value.lng, candidates: [] });
      } else {
        // 定位没落定：要么让用户从候选里挑一家，要么让他用「用当前位置」/手动坐标兜底。
        updateDraft(key, { lat: null, lng: null, candidates: value.candidates || [] });
      }
      return value.message;
    } catch (cause) {
      return cause instanceof Error ? `${cause.message}，请用「用当前位置」或手动输入坐标。` : "自动定位失败，请用「用当前位置」或手动输入坐标。";
    }
  }

  async function recognizeInto(key: string, file: File) {
    try {
      const prepared = await preparePhoto(file);
      const url = URL.createObjectURL(prepared);
      previews.current.add(url);
      updateDraft(key, { preview: url, stage: "recognizing" });
      const image = await readable(prepared);
      const result = await api<{ resolved: RecognizedPlace }>("/api/recognize", {
        method: "POST",
        body: jsonBody({ image }),
      });
      const value = result.resolved;
      updateDraft(key, {
        name: value.name || "", address: value.address || "", cuisine: value.cuisine || "",
        platformRating: value.platformRating != null ? String(value.platformRating) : "",
        ratingCount: value.ratingCount != null ? String(value.ratingCount) : "",
        avgPrice: value.avgPrice != null ? String(value.avgPrice) : "",
        rawText: value.rawText, sourcePlatform: "截图识别", message: value.message,
      });
      const located = await locateInto(key, { name: value.name, address: value.address });
      updateDraft(key, { stage: "", message: `${value.message}${located}` });
    } catch (cause) {
      updateDraft(key, { stage: "", error: cause instanceof Error ? cause.message : "截图识别失败" });
    }
  }

  async function addShots(files: File[]) {
    if (!canBatch || !files.length) return;
    setError("");
    // 开场那条空草稿是给「直接手填」用的；上传截图时先把它当第一张用掉，
    // 否则 5 个槽位里会永远空占一格（实测：传 3 张只会出现 3 张 + 1 条空行）。
    const reuseKey = isPristine(active) ? active.key : null;
    const room = MAX_DRAFTS - (drafts.length - (reuseKey ? 1 : 0));
    if (room <= 0) { setError(`最多 ${MAX_DRAFTS} 个，先保存或删掉一条再传`); return; }
    const picked = files.slice(0, room);
    setNotice(picked.length < files.length ? `一次最多 ${MAX_DRAFTS} 个，这次只处理了前 ${picked.length} 张` : "");
    const items = picked.map((file, index) => ({ key: reuseKey && index === 0 ? reuseKey : nextKey(), file }));
    const fresh = items.filter((item) => item.key !== reuseKey);
    if (reuseKey) updateDraft(reuseKey, { stage: "recognizing", error: "" });
    setDrafts((current) => [...current, ...fresh.map((item) => blankDraft({ key: item.key, stage: "recognizing" }))]);
    setActiveKey(items[0].key);
    await runPool(items, RECOGNIZE_CONCURRENCY, async (item) => { await recognizeInto(item.key, item.file); });
  }

  // 粘一条 → 识别 → 落一份草稿 → 再粘下一条（累积）。不做「一次粘贴多条自动切分」：
  // 美团/点评的分享文案本身就是多行的，按行切会把一条切成两条。
  async function resolveShare() {
    const text = sourceText.trim();
    if (!text) { setError("先粘贴分享内容"); return; }
    const reusable = isPristine(active) ? active.key : null;
    if (!reusable && drafts.length >= MAX_DRAFTS) {
      setError(`最多 ${MAX_DRAFTS} 个，先保存或删掉一条再粘下一条`);
      return;
    }
    const key = reusable ?? nextKey();
    if (!reusable) setDrafts((current) => [...current, blankDraft({ key })]);
    setActiveKey(key);
    setResolving(true);
    setError("");
    updateDraft(key, { sourceText: text, stage: "locating", error: "" });
    try {
      const result = await api<{ resolved: ResolvedPlace }>("/api/resolve", { method: "POST", body: jsonBody({ text }) });
      const value = result.resolved;
      updateDraft(key, {
        name: value.name || "", address: value.address || "",
        lat: value.lat, lng: value.lng,
        sourceUrl: value.sourceUrl, sourcePlatform: value.sourcePlatform, message: value.message,
      });
      let message = value.message;
      // 小程序分享只给名字、不给坐标，这里再试一次反查，省得成员自己在地图上找店。
      if (value.lat === null && value.lng === null) {
        const located = await locateInto(key, { name: value.name, address: value.address });
        if (located) message = `${message}${located}`;
      }
      updateDraft(key, { stage: "", message });
      setSourceText("");
    } catch (cause) {
      updateDraft(key, { stage: "", error: cause instanceof Error ? cause.message : "识别失败" });
    } finally {
      setResolving(false);
    }
  }

  // 用户从候选里挑一家：把它的坐标直接写进草稿，顺手用候选里更完整的地址替换掉
  // 分享文案里那半截（点评只给「东园大厦」，高德给的是「东园路3号…」）。
  function pickCandidate(key: string, candidate: PlaceCandidate, fallbackAddress: string) {
    updateDraft(key, {
      lat: candidate.lat, lng: candidate.lng, candidates: [], error: "",
      address: candidate.address || fallbackAddress,
      message: `已选定「${candidate.name}」，请核对图钉位置。`,
    });
  }

  function locate() {
    if (!navigator.geolocation) { setError("当前浏览器不支持定位，请手动输入坐标"); return; }
    const key = active.key;
    navigator.geolocation.getCurrentPosition(
      (position) => { updateDraft(key, { lat: position.coords.latitude, lng: position.coords.longitude }); setError(""); },
      () => setError("无法获取当前位置，请手动输入坐标"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function persist(draft: Draft) {
    const body = jsonBody({
      name: draft.name.trim(), address: draft.address, category: draft.category,
      recommendation: draft.recommendation,
      lat: draft.lat, lng: draft.lng, sourceText: draft.sourceText, sourceUrl: draft.sourceUrl,
      sourcePlatform: draft.sourcePlatform, cuisine: draft.cuisine,
      platformRating: draft.platformRating, ratingCount: draft.ratingCount, avgPrice: draft.avgPrice,
      sourceRaw: draft.rawText,
    });
    const result = await api<{ id?: string }>(draft.editingId ? `/api/places/${draft.editingId}` : "/api/places", {
      method: draft.editingId ? "PATCH" : "POST",
      body,
    });
    const id = result.id || draft.editingId;
    if (!id) throw new Error("保存成功，但没有返回地点编号，请刷新页面查看");
    return id;
  }

  // 单条模式：保持原有行为 —— 存完直接进该地点的详情页。
  async function saveSingle() {
    const problem = checkDraft(active);
    if (problem) { setError(problem); return; }
    setSaving(true); setError("");
    updateDraft(active.key, { stage: "saving", error: "" });
    try {
      const id = await persist(active);
      onSaved(id);
    } catch (cause) {
      if (cause instanceof ApiError && cause.existingId) { onSaved(cause.existingId); return; }
      updateDraft(active.key, { stage: "", error: cause instanceof Error ? cause.message : "保存失败" });
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  // 批量保存：逐条串行写。串行不是为了省事 —— 并发写会让服务端的「重名重址」判重
  // 出现竞态，两条一样的截图可能双双落库。
  async function saveBatch(queue: Draft[]) {
    if (!queue.length) return;
    setSaving(true); setError("");
    const outcome = new Map<string, "saved" | "existing" | "failed">();
    const savedIds: string[] = [];
    for (const draft of queue) {
      updateDraft(draft.key, { stage: "saving", error: "" });
      try {
        const id = await persist(draft);
        outcome.set(draft.key, "saved");
        savedIds.push(id);
        // 这里不写 existingId —— 它表示「群里已经有了」，存成功的那条会立刻从列表摘掉，
        // 打上这个标记只会在语义上混淆，将来改流程时容易误判成重复。
        updateDraft(draft.key, { stage: "", message: "已收进群地图" });
      } catch (cause) {
        if (cause instanceof ApiError && cause.existingId) {
          outcome.set(draft.key, "existing");
          updateDraft(draft.key, { stage: "", existingId: cause.existingId, message: "群里已经有这个地点，已跳过" });
        } else {
          outcome.set(draft.key, "failed");
          updateDraft(draft.key, { stage: "", error: cause instanceof Error ? cause.message : "保存失败" });
        }
      }
    }
    setSaving(false);

    const duplicate = queue.filter((draft) => outcome.get(draft.key) === "existing").length;
    const failed = queue.filter((draft) => outcome.get(draft.key) === "failed").length;
    // 没参与这轮保存的草稿（比如还没填完的那条）原样留下。
    const untouched = drafts.filter((draft) => !outcome.has(draft.key));

    if (savedIds.length) (onBatchSaved ?? ((ids: string[]) => onSaved(ids[ids.length - 1])))(savedIds);
    if (!untouched.length && !duplicate && !failed) { onClose(); return; }
    // 用函数式更新取「当前」state 来过滤。用闭包里的 drafts 会拿到循环开始前的快照，
    // 把循环中写进去的「群里已有」「失败原因」一起丢掉 —— 实测重复那条保存后会显示
    // 「可保存」，用户看不出为什么它没存进去。
    setDrafts((current) => current.filter((draft) => outcome.get(draft.key) !== "saved"));
    setActiveKey(null);

    const parts: string[] = [];
    if (savedIds.length) parts.push(`已收进群地图 ${savedIds.length} 个`);
    if (duplicate) parts.push(`${duplicate} 个群里已有、已跳过`);
    if (failed) parts.push(`${failed} 个保存失败，请看条目上的说明`);
    const leftUnfinished = untouched.filter((draft) => checkDraft(draft)).length;
    if (leftUnfinished) parts.push(`还有 ${leftUnfinished} 个没填完（名称或地图位置）`);
    setNotice(parts.join("；"));
  }

  // 这条草稿的名称/地址是不是「认出来的」（粘贴分享文案或识别截图）？是的话下面把这两项
  // 单独圈出来提示核对：店名认错、地址认到隔壁店，图钉会稳稳落在错的地方，比缺字段更难发现。
  // 但要同时有内容才圈 —— 截图没读出东西时也要亮起这块，就成了「请核对两个空框」。
  const recognized = active.sourcePlatform !== "手动输入"
    && Boolean(active.name.trim() || active.address.trim());

  const otherPins = drafts
    .filter((draft) => draft.key !== active.key && draft.lat !== null && draft.lng !== null)
    .map((draft) => ({ id: draft.key, name: draft.name || "待保存", lat: draft.lat as number, lng: draft.lng as number, color: "#8aa39c" }));

  return <div className="dialog-backdrop add-backdrop" role="presentation">
    <section className="add-dialog" role="dialog" aria-modal="true" aria-labelledby="add-title">
      <header className="sheet-header">
        <div><h2 id="add-title">{initial ? "编辑地点" : "添加地点"}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={22} /></button>
      </header>
      <form onSubmit={(event) => { event.preventDefault(); if (drafts.length > 1) void saveBatch(ready); else void saveSingle(); }}>
        <div className="add-scroll">
          {canBatch && <div className="import-panel">
            <div className="section-heading"><Link2 size={19} /><strong>从分享内容导入</strong></div>
            {/* 提示拆成三行、一行一件事：原来那一整段要读完才知道有没有用到的那句，而用户是带着
                「我是来粘文案的 / 我是来传截图的」其中一种来的，几行短句能直接跳到要看的那行。 */}
            <ul className="tip-list">
              <li>粘贴美团、大众点评或地图的分享链接 / 文案</li>
              <li>小程序口令认不出店名时，改用截图识别</li>
              <li>一次最多 <strong>{MAX_DRAFTS} 个</strong>：截图可多选，文案一条一条粘</li>
            </ul>
            <textarea className="text-field share-field" value={sourceText} maxLength={3000}
              onChange={(event) => { setSourceText(event.target.value); setNotice(""); }}
              placeholder="在这里粘贴链接或分享文案…" rows={3} />
            {/* 两个入口等宽并排：在「怎么导入」这件事上它们是平级的两条路，不该一上一下。 */}
            <div className="import-actions">
              <button type="button" className="secondary-button" onClick={() => void resolveShare()} disabled={busy}>
                <Sparkles size={17} />{resolving ? "识别中…" : "识别分享内容"}
              </button>
              <label className={`secondary-button ${busy ? "disabled" : ""}`}>
                <ImageUp size={17} />上传截图识别
                <input type="file" accept="image/*" multiple disabled={busy}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (files.length) void addShots(files);
                  }} />
              </label>
            </div>
            {/* 只有一条草稿时列表不展开，预览图仍放在这里，和改造前的观感一致 */}
            {!showList && active.preview && <div className="import-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="shot-preview" src={active.preview} alt="待识别的截图" />
              <span>已选截图</span>
            </div>}
            {notice && <p className="import-notice" role="status">{notice}</p>}
          </div>}

          {showList && <div className="draft-block">
            <div className="section-heading"><ListChecks size={19} /><strong>待保存</strong>
              <span className="draft-count">{drafts.length}/{MAX_DRAFTS}</span>
            </div>
            <p className="draft-hint">点一条改下面的字段；标着「待定位」的，选它之后用「用当前位置」或手动输入坐标补位置。</p>
            <div className="draft-list">
              {drafts.map((draft, index) => {
                const status = draftStatus(draft);
                const isActive = draft.key === active.key;
                return <div className={`draft-row${isActive ? " is-active" : ""}`} key={draft.key}>
                  <button type="button" className="draft-main" onClick={() => setActiveKey(draft.key)} aria-pressed={isActive}>
                    {draft.preview
                      // 本地 object URL 预览，next/image 无法优化；与既有照片展示保持同一种做法
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img className="draft-thumb" src={draft.preview} alt="" />
                      : <span className="draft-thumb draft-thumb-blank"><MapPinned size={20} /></span>}
                    <span className="draft-content">
                      <span className="draft-head">
                        <strong>{draft.name.trim() || (draft.stage === "recognizing" ? "正在读这张截图…" : "还没识别出名称")}</strong>
                        <span className={`draft-badge is-${status.tone}`}>{status.text}</span>
                      </span>
                      <span className="draft-line">{draft.address || "地址待补充"}</span>
                      <span className="draft-line">
                        {[
                          draft.avgPrice ? `人均 ¥${draft.avgPrice}` : "",
                          draft.cuisine,
                          draft.platformRating ? `平台 ${draft.platformRating}` : "",
                        ].filter(Boolean).join(" · ") || "人均与评分待补充"}
                      </span>
                      {!draft.name.trim() && draft.message && <span className="draft-line">{draft.message}</span>}
                      {draft.error && <span className="draft-line draft-line-bad">{draft.error}</span>}
                    </span>
                  </button>
                  <span className="draft-side">
                    {/* 只剩一条时不给删：删空会让下面所有字段失去绑定对象。 */}
                    {drafts.length > 1 && <button type="button" className="draft-remove" onClick={() => removeDraft(draft.key)}
                      aria-label={`从待保存列表删掉第 ${index + 1} 条：${draft.name.trim() || "未命名"}`}><X size={18} /></button>}
                  </span>
                </div>;
              })}
            </div>
          </div>}

          {/* 名称与地址单独成块、各占整行 —— 它们是「这条数据对不对」的全部依据，挤在
              130px 的窄列里既看不全也核对不了。来自识别时再套一层浅底把它顶出来。 */}
          <div className={`verify-block${recognized ? " is-verify" : ""}`}>
            {recognized && <>
              <div className="section-heading"><BadgeCheck size={19} /><strong>核对识别结果</strong>
                <span className="verify-tag">{active.sourcePlatform}</span></div>
              {/* 和导入提示同一种三行短句、同一个 .tip-list —— 两处提示长得一样，才不用重新读一遍 */}
              <ul className="tip-list">
                <li>下面两项是从{active.sourcePlatform}认出来的</li>
                <li>先核对是不是你要找的那家，再往下填</li>
                <li>认错了就直接改这两个框</li>
              </ul>
            </>}
            <div className="field-block">
              <label className="field-label" htmlFor="place-name">地点名称 <span>*</span></label>
              <input className="text-field place-name-field" id="place-name" value={active.name} maxLength={80}
                onChange={(event) => updateDraft(active.key, { name: event.target.value, error: "", candidates: [] })} placeholder="店名或想去的地方" />
            </div>
            <div className="field-block">
              <label className="field-label" htmlFor="place-address">地址</label>
              <input className="text-field place-address-field" id="place-address" value={active.address} maxLength={200}
                onChange={(event) => updateDraft(active.key, { address: event.target.value })} placeholder="街道、商场或地标" />
            </div>
          </div>
          {/* 推荐理由只由人写，识别产不出它 —— 所以刻意放在上面那个「核对识别结果」高亮块之外，
              否则会读成「这也是认出来的、也要核对」。 */}
          <div className="field-block">
            <label className="field-label" htmlFor="place-recommendation">推荐理由（选填）</label>
            <textarea className="text-field" id="place-recommendation" rows={3} maxLength={150}
              value={active.recommendation}
              onChange={(event) => updateDraft(active.key, { recommendation: event.target.value })}
              placeholder="为什么推荐这家？好不好停车、要不要排队、几点去最合适…" />
          </div>
          <div className="field-grid even">
            <div className="field-block">
              <label className="field-label" htmlFor="place-category">类型</label>
              <select className="text-field" id="place-category" value={active.category}
                onChange={(event) => updateDraft(active.key, { category: event.target.value as Category })}>
                <option value="美食">美食</option><option value="玩乐">玩乐</option>
              </select>
            </div>
            <div className="field-block">
              <label className="field-label" htmlFor="place-price">人均价格（元）</label>
              <input className="text-field" id="place-price" type="number" inputMode="numeric" min={0} value={active.avgPrice}
                onChange={(event) => updateDraft(active.key, { avgPrice: event.target.value })} placeholder="截图里没有就留空" />
            </div>
          </div>
          {/* 菜系/品类与评价条数已从这里撤掉：前者识别得到就自动带上、列表里照样显示，成员几乎不会手改；
              后者只作为评分后面的「· 2280 条」出现，也不值得占一个输入框。两者都仍由截图识别写入。 */}
          <div className="field-grid even">
            <div className="field-block">
              <label className="field-label" htmlFor="place-rating">平台评分</label>
              <input className="text-field" id="place-rating" type="number" inputMode="decimal" step="0.1" min={0} max={5} value={active.platformRating}
                onChange={(event) => updateDraft(active.key, { platformRating: event.target.value })} placeholder="0–5，没有就留空" />
            </div>
          </div>
          <p className="field-hint">平台评分与人均来自美团／大众点评截图，会过时，和群里自己的评分是两回事。</p>
          <div className="location-heading">
            <div><span className="field-label">地图位置 <span>*</span></span><p>识别出地址后自动定位，地图仅作核对</p></div>
            <button type="button" className="text-button" onClick={locate}><Crosshair size={17} />用当前位置</button>
          </div>
          {active.candidates.length > 0 && <div className="candidate-block">
            <div className="section-heading"><MapPinned size={19} /><strong>找到多家，选一家</strong></div>
            <p className="draft-hint">{active.message || "同名门店不止一家，点正确的那家；都不是就手动输入坐标。"}</p>
            <div className="candidate-list">
              {active.candidates.map((candidate, index) => <button type="button" className="candidate-row"
                key={`${candidate.name}-${candidate.lat}-${index}`}
                onClick={() => pickCandidate(active.key, candidate, active.address)}>
                <span className="candidate-name">{candidate.name}</span>
                <span className="candidate-address">{candidate.address || "地址未提供"}</span>
              </button>)}
            </div>
          </div>}
          {/* 地图只做展示，不接受点按取点：手机上在地图上点准一家店本来就很难，点歪了还看不出来，
              而图钉本来就能由识别的地址反查出来。要改位置只剩「用当前位置」和手动输入坐标两条路。 */}
          <MapCanvas places={otherPins} picked={active.lat !== null && active.lng !== null ? { lat: active.lat, lng: active.lng } : null}
            className="picker-map" />
          <div className="coordinate-row"><MapPin size={16} />{active.lat !== null && active.lng !== null
            ? `已定位：${active.lat.toFixed(5)}, ${active.lng.toFixed(5)}`
            : "还没定位到：用「用当前位置」，或在下面手动输入坐标"}</div>
          <details className="coordinate-manual">
            <summary>位置不对？手动输入坐标</summary>
            <div className="coordinate-inputs">
              <input className="text-field" type="number" step="any" aria-label="纬度" placeholder="纬度" value={active.lat ?? ""}
                onChange={(event) => updateDraft(active.key, { lat: Number(event.target.value), lng: active.lng ?? 114.06 })} />
              <input className="text-field" type="number" step="any" aria-label="经度" placeholder="经度" value={active.lng ?? ""}
                onChange={(event) => updateDraft(active.key, { lng: Number(event.target.value), lat: active.lat ?? 22.55 })} />
            </div>
          </details>
          {active.rawText && <details className="source-note" open>
            <summary>核对识别到的原文</summary>
            <p>{active.rawText}</p>
          </details>}
          {!active.rawText && active.message && <p className="import-notice" role="status">{active.message}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="sheet-footer">
          {drafts.length > 1 ? <>
            <button type="button" className="primary-button full" onClick={() => void saveBatch(ready)} disabled={busy}>
              {saving ? "保存中…" : `全部保存（${ready.length}）`}
            </button>
            <button type="button" className="secondary-button full" onClick={() => void saveBatch([active])}
              disabled={busy || Boolean(checkDraft(active))}>只保存当前这一条</button>
            {unfinished > 0 && <p className="footer-hint">还有 {unfinished} 条没填完（名称或地图位置），补完再一起存。</p>}
          </> : <button className="primary-button full" disabled={busy}>
            {saving ? "保存中…" : initial ? "保存修改" : "保存到群地图"}
          </button>}
        </div>
      </form>
    </section>
  </div>;
}
