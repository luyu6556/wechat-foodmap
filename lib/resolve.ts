export type ResolvedPlace = {
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  sourceUrl: string | null;
  sourcePlatform: string;
  message: string;
};

const URL_RE = /https?:\/\/[^\s<>\])，。]+/i;

function validPair(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function outsideChina(lat: number, lng: number) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(lng: number, lat: number) {
  let ret = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  ret += (20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(lat * Math.PI) + 40 * Math.sin(lat / 3 * Math.PI)) * 2 / 3;
  ret += (160 * Math.sin(lat / 12 * Math.PI) + 320 * Math.sin(lat * Math.PI / 30)) * 2 / 3;
  return ret;
}

function transformLng(lng: number, lat: number) {
  let ret = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  ret += (20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(lng * Math.PI) + 40 * Math.sin(lng / 3 * Math.PI)) * 2 / 3;
  ret += (150 * Math.sin(lng / 12 * Math.PI) + 300 * Math.sin(lng / 30 * Math.PI)) * 2 / 3;
  return ret;
}

export function gcjToWgs(lat: number, lng: number): [number, number] {
  if (outsideChina(lat, lng)) return [lat, lng];
  const a = 6378245;
  const ee = 0.006693421622965943;
  const dLat = transformLat(lng - 105, lat - 35);
  const dLng = transformLng(lng - 105, lat - 35);
  const radLat = lat / 180 * Math.PI;
  const magic = 1 - ee * Math.sin(radLat) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  const mgLat = lat + dLat * 180 / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  const mgLng = lng + dLng * 180 / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return [lat * 2 - mgLat, lng * 2 - mgLng];
}

function bdToWgs(lat: number, lng: number): [number, number] {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI * 3000 / 180);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI * 3000 / 180);
  return gcjToWgs(z * Math.sin(theta), z * Math.cos(theta));
}

function pair(value: string | null, order: "latlng" | "lnglat") {
  if (!value) return null;
  const numbers = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!numbers || numbers.length < 2) return null;
  const [lat, lng] = order === "latlng" ? [numbers[0], numbers[1]] : [numbers[1], numbers[0]];
  return validPair(lat, lng) ? [lat, lng] as [number, number] : null;
}

function sourceName(host: string) {
  if (host.includes("meituan.com")) return "美团";
  if (host.includes("dianping.com") || host.includes("dpurl.cn")) return "大众点评";
  if (host.includes("maps.apple.com")) return "苹果地图";
  if (host.includes("amap.com")) return "高德地图";
  if (host.includes("baidu.com")) return "百度地图";
  if (host.includes("qq.com")) return "腾讯地图";
  return "网页链接";
}

export function resolveSharedText(input: string): ResolvedPlace {
  const raw = input.trim().slice(0, 3000);
  const mini = raw.match(/#小程序:\/\/([^\s\n]+)/);
  if (mini) {
    return {
      name: "", address: "", lat: null, lng: null, sourceUrl: null,
      sourcePlatform: "微信小程序",
      message: "已识别微信小程序口令。口令本身不包含店名和位置，请补填后在地图上选点。",
    };
  }

  const match = raw.match(URL_RE);
  if (!match) {
    return { name: raw.split(/[\n，,]/)[0]?.slice(0, 80) ?? "", address: "", lat: null, lng: null, sourceUrl: null, sourcePlatform: "手动输入", message: "请确认名称，并在地图上选择位置。" };
  }

  let url: URL;
  try { url = new URL(match[0]); } catch {
    return { name: "", address: "", lat: null, lng: null, sourceUrl: null, sourcePlatform: "网页链接", message: "链接格式无法识别，请手动填写。" };
  }
  const host = url.hostname.toLowerCase();
  const platform = sourceName(host);
  const params = url.searchParams;
  let name = params.get("name") || params.get("title") || params.get("q") || "";
  const address = params.get("address") || "";
  let point: [number, number] | null = null;

  if (host === "maps.apple.com") {
    point = pair(params.get("coordinate") || params.get("ll"), "latlng");
    name = params.get("name") || params.get("q") || name;
  } else if (host.endsWith("amap.com")) {
    const parsed = pair(params.get("position") || params.get("center") || params.get("location"), "lnglat");
    point = parsed ? gcjToWgs(...parsed) : null;
    name = params.get("name") || params.get("keyword") || name;
  } else if (host.endsWith("baidu.com")) {
    const parsed = pair(params.get("location") || params.get("latlng"), "latlng");
    point = parsed ? bdToWgs(...parsed) : null;
    name = params.get("title") || name;
  } else if (host.endsWith("qq.com")) {
    const marker = params.get("marker") || "";
    const coord = marker.match(/coord:([-\d.]+),([-\d.]+)/);
    const parsed = coord ? pair(`${coord[1]},${coord[2]}`, "latlng") : null;
    point = parsed ? gcjToWgs(...parsed) : null;
    name = marker.match(/title:([^;]+)/)?.[1] || name;
  }

  if (!name) {
    const before = raw.slice(0, match.index).replace(/[\[\]【】\s:：]+$/g, "").trim();
    if (before && !/^(分享|链接|点击|复制)/.test(before)) name = before.split("\n").at(-1)?.slice(0, 80) || "";
  }
  if (name.startsWith("http")) name = "";
  return {
    name: name.slice(0, 80), address: address.slice(0, 200),
    lat: point?.[0] ?? null, lng: point?.[1] ?? null,
    sourceUrl: url.toString(), sourcePlatform: platform,
    message: point ? "已从地图链接识别地点和坐标，请核对后保存。" : "已保存来源链接。请核对店名、地址，并在地图上选点。",
  };
}
