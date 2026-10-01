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

function isHost(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function sharedName(value: string) {
  const lines = value.split(/\n/).map((line) => line.trim())
    // 文案常见「【店名】宣传语 【地址：…】」，优先取开头成对的括号段，避免把宣传语和地址一起当成店名。
    .map((line) => {
      const wrapped = line.match(/^[【\[]([^】\]]+)[】\]]/);
      return wrapped ? wrapped[1].trim() : line.replace(/^[【\[]|[】\]]$/g, "");
    })
    .filter((line) => line && !/^(分享|链接|点击|复制|打开微信|美团|大众点评)$/.test(line));
  return (lines.at(-1) || "").slice(0, 80);
}

// 点评／美团的分享文案把店名、地址、电话各放在一个【】分段里。
// 这些字段只存在于文案中，短链（如 dpurl.cn）的 URL 参数里没有，必须从文字里取。
function bracketFields(text: string) {
  const segments = [...text.matchAll(/【([^】]*)】/g)]
    .map((match) => match[1].trim()).filter(Boolean);
  let address = "";
  const names: string[] = [];
  for (const segment of segments) {
    const labelled = segment.match(/^(?:地址|位置|地点)\s*[:：]\s*(.+)$/);
    if (labelled) { if (!address) address = labelled[1].trim(); continue; }
    if (/^(?:电话|手机|联系方式|营业时间|人均|评分|评分人数)\s*[:：]/.test(segment)) continue;
    if (/^(?:分享|链接|点击|复制|打开微信|美团|大众点评)$/.test(segment)) continue;
    names.push(segment);
  }
  return { address, names };
}

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

export function wgsToGcj(lat: number, lng: number): [number, number] {
  if (outsideChina(lat, lng)) return [lat, lng];
  const a = 6378245;
  const ee = 0.006693421622965943;
  const dLat = transformLat(lng - 105, lat - 35);
  const dLng = transformLng(lng - 105, lat - 35);
  const radLat = lat / 180 * Math.PI;
  const magic = 1 - ee * Math.sin(radLat) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  return [
    lat + dLat * 180 / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI),
    lng + dLng * 180 / (a / sqrtMagic * Math.cos(radLat) * Math.PI),
  ];
}

export function bdToWgs(lat: number, lng: number): [number, number] {
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
  if (isHost(host, "meituan.com")) return "美团";
  if (isHost(host, "dianping.com") || isHost(host, "dpurl.cn")) return "大众点评";
  if (host === "maps.apple.com") return "苹果地图";
  if (isHost(host, "amap.com")) return "高德地图";
  if (isHost(host, "baidu.com")) return "百度地图";
  if (isHost(host, "qq.com")) return "腾讯地图";
  return "网页链接";
}

export function resolveSharedText(input: string): ResolvedPlace {
  const raw = input.trim().slice(0, 3000);
  const fields = bracketFields(raw);
  const mini = raw.match(/#小程序:\/\/([^\s\n]+)/);
  if (mini) {
    const name = fields.names[0] || sharedName(raw.slice(0, mini.index));
    return {
      name, address: fields.address, lat: null, lng: null, sourceUrl: null,
      sourcePlatform: "微信小程序",
      message: name ? "已从分享文案提取名称。小程序口令不含公开坐标，请核对并在地图上选点。" : "已识别微信小程序口令。口令本身不包含店名和位置，请补填后在地图上选点。",
    };
  }

  const match = raw.match(URL_RE);
  if (!match) {
    const name = fields.names[0] || raw.split(/[\n，,]/)[0]?.slice(0, 80) || "";
    return { name, address: fields.address, lat: null, lng: null, sourceUrl: null, sourcePlatform: "手动输入", message: "请确认名称，并在地图上选择位置。" };
  }

  let url: URL;
  try { url = new URL(match[0].replace(/[.,;!?]+$/, "")); } catch {
    return { name: "", address: "", lat: null, lng: null, sourceUrl: null, sourcePlatform: "网页链接", message: "链接格式无法识别，请手动填写。" };
  }
  const host = url.hostname.toLowerCase();
  const platform = sourceName(host);
  const params = url.searchParams;
  let name = params.get("name") || params.get("title") || params.get("q") || "";
  // 地址优先用链接参数；短链没有参数时回退到文案里的【地址：…】分段。
  const address = params.get("address") || fields.address;
  let point: [number, number] | null = null;

  if (host === "maps.apple.com") {
    point = pair(params.get("coordinate") || params.get("ll"), "latlng");
    name = params.get("name") || params.get("q") || name;
  } else if (isHost(host, "amap.com")) {
    const parsed = pair(params.get("position") || params.get("center") || params.get("location"), "lnglat");
    point = parsed ? gcjToWgs(...parsed) : null;
    name = params.get("name") || params.get("keyword") || name;
  } else if (isHost(host, "baidu.com")) {
    const parsed = pair(params.get("location") || params.get("latlng"), "latlng");
    point = parsed ? bdToWgs(...parsed) : null;
    name = params.get("title") || name;
  } else if (isHost(host, "qq.com")) {
    const marker = params.get("marker") || "";
    const coord = marker.match(/coord:([-\d.]+),([-\d.]+)/);
    const parsed = coord ? pair(`${coord[1]},${coord[2]}`, "latlng") : null;
    point = parsed ? gcjToWgs(...parsed) : null;
    name = marker.match(/title:([^;]+)/)?.[1] || name;
  }

  if (!name) name = fields.names[0] || "";
  if (!name) {
    name = sharedName(raw.slice(0, match.index).replace(/[:：]+$/g, ""));
  }
  if (name.startsWith("http")) name = "";
  return {
    name: name.slice(0, 80), address: address.slice(0, 200),
    lat: point?.[0] ?? null, lng: point?.[1] ?? null,
    sourceUrl: url.toString(), sourcePlatform: platform,
    message: point ? "已从地图链接识别地点和坐标，请核对后保存。" : "已保存来源链接。请核对店名、地址，并在地图上选点。",
  };
}
