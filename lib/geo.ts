import { env } from "cloudflare:workers";
import { gcjToWgs } from "./resolve";

export type PlaceCandidate = {
  name: string;
  address: string;
  lat: number;
  lng: number;
  // 分店也对得上（输入「(东园路2号店)」、候选是东园路那家）→ 可直接采用。
  // 只有主体名相同而分店不同（输入东园路、候选南山店）时为 false —— 那不是同一家店。
  exactBranch: boolean;
};

export type GeocodeResult = {
  lat: number | null;
  lng: number | null;
  source: "poi" | "address" | "none";
  confidence: number;
  matchedName: string;
  message: string;
  // 有歧义时把命中的候选交给用户挑，而不是静默取第一个 —— 错误点位看起来和正确的一模一样。
  candidates: PlaceCandidate[];
};

// 底图和定位统一走高德：底图是 GCJ-02，高德返回的也是 GCJ-02，gcjToWgs 一步到位；
// 之前用百度要 BD-09 → GCJ-02 → WGS-84 转两次，多一次近似误差。
const AMAP_REST = "https://restapi.amap.com/v3";

const POI_CONFIDENCE = 90;
const ADDRESS_CONFIDENCE = 70;

// place/text 对任何关键词都会返回结果，必须拿名字复核（见 nameMatches）。
const POI_PAGE_SIZE = 5;

// geocode/geo 的 level 直接说明命中了什么。判据用**黑名单**而不是白名单：
// 白名单是拿两个观测值（兴趣点 / 门址）拟合出来的，换个地址就误杀 —— 2026-10-02 实测
// 「海德二道3009号正东名苑」→ `住宅区`、「人民路4022号壹方天地B区L1层」→ `小巷`，
// 两者其实都足够具体（小区中心、巷子），却被白名单挡下，白丢两个能用的图钉。
// 反过来只有「面」级的等级才拒绝：图钉会落在省/市/区中心、乡镇驻地、商圈质心或道路中线上。
const COARSE_ADDRESS_LEVELS = new Set(["国家", "省", "城市", "区县", "乡镇", "热点商圈", "道路"]);

function defaultCityValue() {
  return env.DEFAULT_CITY || "深圳";
}

export function defaultCity() {
  return defaultCityValue();
}

// 「巴扎美食·新疆菜·西域歌舞表演餐厅(新疆大厦店)」 → 「巴扎美食新疆菜西域歌舞表演餐厅」
function coreName(value: string) {
  return value
    .replace(/[（(][^（()）]*[)）]/g, "")
    .replace(/[\s·・\-–—~、,，.。!！?？:：'"“”/\\|]/g, "")
    .toLowerCase();
}

// 分店后缀必须单独留下来：coreName 会把「(东园路2号店)」整段删掉，于是「(东园路2号店)」和「(南山店)」
// 变成同一个字符串，同名连锁的不同门店再也区分不开 —— 图钉会落到先返回的那家分店上。
// 只取末尾的括号：店名中间的括号不是分店后缀。
function branchOf(value: string) {
  const match = value.match(/[（(]([^（()）]*)[)）]\s*$/);
  return match ? coreName(match[1]) : "";
}

// 去掉末尾分店后缀后的主体名。
function baseOf(value: string) {
  return coreName(value.replace(/[（(][^（()）]*[)）]\s*$/, ""));
}

// 分店名去掉门牌号再比对：点评写「东园路2号店」、高德 POI 写「东园路3号」，是同一家店。
// 反过来「南山店」不会因此被当成东园路那家。
function branchKey(value: string) {
  return coreName(value).replace(/[0-9a-z]+号?/g, "").replace(/店$/, "");
}

function branchMatches(wanted: string, candidateName: string, candidateAddress: string) {
  const wantedKey = branchKey(wanted);
  if (!wantedKey) return true; // 输入里没有可用的分店信息，只按主体名算。
  const candidateBranch = branchOf(candidateName);
  const pool = coreName(candidateName) + coreName(candidateAddress);
  // 高德的 POI 名常常不带分店后缀，分店信息只出现在地址里（实测：「山葵烤肉by SHANKUI BBQ」
  // 这条 POI 名字没有括号，地址却是「东园路3号…」），所以候选名和地址一起找。
  if (!candidateBranch) return pool.includes(wantedKey);
  const candidateKey = branchKey(candidateBranch);
  if (!candidateKey) return pool.includes(wantedKey);
  return candidateKey === wantedKey
    || candidateKey.includes(wantedKey)
    || wantedKey.includes(candidateKey);
}

// A POI search always returns *something*, so the result has to be checked against the name
// we asked for. Without this the closed shop 「巴扎美食·新疆菜…」 matched 「清真新疆大巴扎美食」,
// which is a different restaurant — a wrong pin looks exactly like a right one.
function nameMatches(recognized: string, candidate: string) {
  const wanted = coreName(recognized);
  const found = coreName(candidate);
  if (!wanted || !found) return false;
  if (wanted === found || wanted.includes(found) || found.includes(wanted)) return true;
  const pool = new Set(found);
  const hit = [...new Set(wanted)].filter((char) => pool.has(char)).length;
  return hit / new Set(wanted).size >= 0.7;
}

type AmapPoi = { name?: string; address?: string; location?: string };
type AmapGeocode = { formatted_address?: string; location?: string; level?: string };

// 高德是 "lng,lat"，百度是 {lat,lng} —— 顺序反了，别照抄。
function parseLocation(value?: string): [number, number] | null {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length < 2) return null;
  const [lng, lat] = parts;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return [lat, lng];
}

async function amapFetch(url: URL) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("定位服务暂不可用");
  return await response.json() as {
    status?: string; info?: string; infocode?: string;
    pois?: unknown; geocodes?: unknown;
  };
}

async function amapJson(path: string, params: Record<string, string>) {
  const url = new URL(`${AMAP_REST}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("key", env.AMAP_WEB_KEY as string);
  url.searchParams.set("output", "JSON");
  let payload = await amapFetch(url);
  // 并发/频率超限（10004 / 10021）等一下再试一次：批量导入 5 条时几条定位会挤在一起发出去，
  // 实测 8 个并发必撞 10021。只重试一次 —— 重试太多会把卡顿转嫁给所有人。
  if (payload.infocode === "10004" || payload.infocode === "10021") {
    await new Promise((resolve) => setTimeout(resolve, 700));
    payload = await amapFetch(url);
  }
  if (payload.status !== "1") {
    console.error("amap rest failed", payload.infocode, payload.info);
    const code = payload.infocode || "";
    if (code === "10001" || code === "10002" || code === "10005" || code === "10009" || code === "10010" || code === "10012") {
      throw new Error("定位服务密钥校验失败");
    }
    if (code === "10003") throw new Error("定位服务今日额度已用完");
    // 10004 / 10021 是并发与频率超限（实测 10021 = CUQPS_HAS_EXCEEDED_THE_LIMIT：连着发
    // 8 个请求就会撞上）。这和「今日额度用完」不是一回事 —— 等两秒就能重试，
    // 说成今天都不能用会让用户白等一天。
    if (code === "10004" || code === "10021") throw new Error("定位服务正忙，请稍后再试");
    throw new Error("定位服务暂不可用");
  }
  return payload;
}

function collectHits(results: AmapPoi[], wanted: string): PlaceCandidate[] {
  const wantedBase = baseOf(wanted);
  const wantedBranch = branchOf(wanted);
  const hits: PlaceCandidate[] = [];
  for (const item of results) {
    const parsed = parseLocation(item.location);
    if (!item.name || !parsed) continue;
    // 只比主体名：分店差异放到 exactBranch 单独判，用来决定「能不能直接采用」。
    if (!nameMatches(wantedBase, baseOf(item.name))) continue;
    const [lat, lng] = gcjToWgs(parsed[0], parsed[1]);
    hits.push({
      name: item.name,
      address: item.address || "",
      lat,
      lng,
      exactBranch: branchMatches(wantedBranch, item.name, item.address || ""),
    });
  }
  return hits;
}

async function amapLocate(name: string, address: string, city: string): Promise<GeocodeResult> {
  if (name) {
    // 先按全名查（含分店后缀）：实测「山葵烤肉by SHANKUI BBQ(东园路2号店)」在高德只返回 1 条，
    // 正是东园路那家。全名查不到再退回主体名，覆盖点评和高德分店写法不一致的情况。
    let poi = await amapJson("/place/text", {
      keywords: name, city, offset: String(POI_PAGE_SIZE), page: "1", extensions: "base",
    });
    let hits = collectHits((poi.pois || []) as AmapPoi[], name);
    const base = name.replace(/[（(][^（()）]*[)）]\s*$/, "").trim();
    if (!hits.length && base && base !== name) {
      poi = await amapJson("/place/text", {
        keywords: base, city, offset: String(POI_PAGE_SIZE), page: "1", extensions: "base",
      });
      hits = collectHits((poi.pois || []) as AmapPoi[], name);
    }

    if (hits.length) {
      // 分店也一致的排前面，展示时更好挑。
      hits.sort((a, b) => Number(b.exactBranch) - Number(a.exactBranch));
      const exact = hits.filter((hit) => hit.exactBranch);
      if (exact.length === 1) {
        // 唯一一家主体名和分店都对得上 —— 和改动前一样直接采用，不打扰用户。
        return {
          lat: exact[0].lat, lng: exact[0].lng, source: "poi", confidence: POI_CONFIDENCE,
          matchedName: exact[0].name, candidates: [],
          message: `已按店名定位到「${exact[0].name}」，请核对图钉位置。`,
        };
      }
      // 要么多家都精确命中，要么只找到同品牌的其他分店 —— 两种情况下「选第一家」都是错的选择。
      return {
        lat: null, lng: null, source: "none", confidence: 0, matchedName: "",
        candidates: hits.slice(0, POI_PAGE_SIZE),
        message: exact.length > 1
          ? "找到多家同名的店，请选择正确的那家。"
          : "没找到这家分店，下面是同品牌的其他门店，请选一家。",
      };
    }
  }

  if (address) {
    const geo = await amapJson("/geocode/geo", { address, city });
    const item = ((geo.geocodes || []) as AmapGeocode[])[0];
    const parsed = parseLocation(item?.location);
    const level = item?.level || "";
    if (parsed && level && !COARSE_ADDRESS_LEVELS.has(level)) {
      const [lat, lng] = gcjToWgs(parsed[0], parsed[1]);
      return {
        lat, lng, source: "address", confidence: ADDRESS_CONFIDENCE, matchedName: "", candidates: [],
        message: item?.formatted_address
          ? `已按地址定位到「${item.formatted_address}」，请核对图钉位置。`
          : "已按地址定位，请核对图钉位置。",
      };
    }
    // 命中面级等级（区县 / 乡镇 / 商圈 / 道路）或没给等级 → 拒绝：放一个看起来合理的错图钉
    // 比不放更糟，用户不会去核对。
    console.log("amap geocode too vague", level, address);
  }

  return {
    lat: null, lng: null, source: "none", confidence: 0, matchedName: "", candidates: [],
    message: "没能可靠定位到这家店，请用「用当前位置」或手动输入坐标。",
  };
}

export async function locate(name: string, address: string, city: string): Promise<GeocodeResult> {
  // 定位与底图同为高德（AMAP_WEB_KEY 同时支撑 JS 底图和 REST 定位，实测两个接口都通）。
  // 百度那套已移除：坐标系不一致、且在本群的样本上 POI 覆盖更差（山葵烤肉东园路店百度没有）。
  if (!env.AMAP_WEB_KEY) throw new Error("自动定位尚未配置");
  return amapLocate(name, address, city);
}
