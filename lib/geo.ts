import { env } from "cloudflare:workers";
import { bdToWgs } from "./resolve";

export type GeocodeResult = {
  lat: number | null;
  lng: number | null;
  source: "poi" | "address" | "none";
  confidence: number;
  matchedName: string;
  message: string;
};

// Baidu returns BD-09; the rest of the app stores WGS-84 (see lib/resolve.ts). Geocoding
// a shop name is far more accurate than geocoding an address: verified 2026-09-30 on the
// real screenshots — the name search hit the exact shop (「马一家东北家常菜(百汇广场店)」,
// 23.131242/113.270274) while the incomplete address「越秀区百汇广场负一楼」only resolved to
// the district centroid at confidence 20. So: name first, address as fallback.
const ADDRESS_CONFIDENCE_FLOOR = 50;
const POI_CONFIDENCE = 90;

export function defaultCity() {
  return env.DEFAULT_CITY || "深圳";
}

// 「巴扎美食·新疆菜·西域歌舞表演餐厅(新疆大厦店)」 → 「巴扎美食新疆菜西域歌舞表演餐厅」
function coreName(value: string) {
  return value
    .replace(/[（(][^（()）]*[)）]/g, "")
    .replace(/[\s·・\-–—~、,，.。!！?？:：'"“”/\\|]/g, "")
    .toLowerCase();
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

type BaiduPoi = { name?: string; location?: { lat?: number; lng?: number } };

async function baiduJson(path: string, params: Record<string, string>) {
  const url = new URL(`https://api.map.baidu.com${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("定位服务暂不可用");
  const payload = await response.json() as { status?: number; message?: string; result?: unknown; results?: unknown };
  const status = payload.status ?? -1;
  if (status !== 0) {
    console.error("baidu map failed", status, payload.message);
    if (status === 210 || status === 211) throw new Error("定位服务密钥校验失败");
    if (status === 302 || status === 401) throw new Error("定位服务今日额度已用完");
    throw new Error("定位服务暂不可用");
  }
  return payload;
}

async function baiduLocate(name: string, address: string, city: string): Promise<GeocodeResult> {
  const ak = env.BAIDU_MAP_AK as string;

  if (name) {
    const poi = await baiduJson("/place/v2/search", {
      query: name, region: city, output: "json", ak, page_size: "5",
    });
    const results = (poi.results || []) as BaiduPoi[];
    const match = results.find((item) => item.name && item.location
      && typeof item.location.lat === "number" && typeof item.location.lng === "number"
      && nameMatches(name, item.name));
    if (match) {
      const [lat, lng] = bdToWgs(match.location!.lat!, match.location!.lng!);
      return {
        lat, lng, source: "poi", confidence: POI_CONFIDENCE, matchedName: match.name!,
        message: `已按店名定位到「${match.name}」，请核对图钉位置。`,
      };
    }
  }

  if (address) {
    const geo = await baiduJson("/geocoding/v3/", { address, city, output: "json", ak });
    const result = geo.result as { location?: { lng?: number; lat?: number }; confidence?: number } | undefined;
    const location = result?.location;
    const confidence = typeof result?.confidence === "number" ? result.confidence : 0;
    if (location && typeof location.lat === "number" && typeof location.lng === "number"
      && confidence >= ADDRESS_CONFIDENCE_FLOOR) {
      const [lat, lng] = bdToWgs(location.lat, location.lng);
      return {
        lat, lng, source: "address", confidence, matchedName: "",
        message: `已按地址定位（可信度 ${confidence}），请核对图钉位置。`,
      };
    }
    // Low confidence means Baidu only recognised a district, i.e. the pin would land on the
    // district centroid. Refusing is better than dropping a plausible-looking wrong pin.
    console.log("address geocode too vague", confidence, address);
  }

  return {
    lat: null, lng: null, source: "none", confidence: 0, matchedName: "",
    message: "没能可靠定位到这家店，请在地图上点选位置。",
  };
}

export async function locate(name: string, address: string, city: string): Promise<GeocodeResult> {
  // Only Baidu is implemented. The 高德 branch goes here if the group switches back:
  // it would reuse gcjToWgs (the 高德 coordinate transform) instead of bdToWgs.
  if (!env.BAIDU_MAP_AK) throw new Error("自动定位尚未配置");
  return baiduLocate(name, address, city);
}
