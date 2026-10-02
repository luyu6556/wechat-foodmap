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

// 域名 → 平台名。**没有 `dpurl.cn`**：它是美团系短链，两平台共用，按域名判必然出歧义（见 detectSourcePlatform）。
const HOST_PLATFORMS: [string, string][] = [
  ["meituan.com", "美团"],
  ["dianping.com", "大众点评"],
  ["amap.com", "高德地图"],
  ["baidu.com", "百度地图"],
  ["qq.com", "腾讯地图"],
];
// 美团 App 分享会在文案尾部追加「@美团」；点评分享不追加。要求带 @ 前缀，避免把正文里
// 顺口提到的「美团」当来源（例如「美团必吃榜」）。
const TEXT_PLATFORM = /@\s*美团/;

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

// 点评 / 美团的分享文案并不总是把地址放进【】里：实测（2026-10-01 用户样例）地址就是一行
// 光秃秃的「东园大厦」，没有「地址：」前缀也没有括号。这类裸行只能靠形态认。
//
// ⚠️ 判据**不能是「以地址词结尾」**。2026-10-02 用户样例「红荔路园岭新村106栋101-1」末尾是
// 房号「-1」，按结尾词判整条漏掉（首版规则就是这么错的：被单个样例拟合，只对
// 「东园大厦」这种以「大厦」结尾的地址成立）。改成两级命中，强词不看结尾：
//   一级：出现只可能属于地址的词（路 / 街 / 新村 / 大厦 / 广场 / 中心…）；
//   二级：兜底，既带数字又带门牌类字（号 / 栋 / 室 / 楼 / 单元…），覆盖「海德二道3009号正东名苑」。
const ADDRESS_STRONG = /(路|街|大道|大街|新村|小区|社区|大厦|大楼|公寓|花园|广场|市场|商城|中心|工业区|科技园|园区)/;
const ADDRESS_WEAK = /(号|栋|幢|座|楼|室|单元|层|区|村|里|苑|园|院)/;
// 点评的「商圈 + 品类」行（「iN城市广场 融合烤肉」「八卦岭/园岭 冰淇淋」）不是地址：
// 它以空格分隔、尾段是餐饮品类词 —— 只看空格会把整个商圈当成门牌。
const CUISINE_TAIL = /[\s·][^\s]*(?:烤肉|火锅|川菜|粤菜|湘菜|日料|寿司|咖啡|甜品|冰淇淋|小吃|快餐|烧烤|串串|料理|餐厅|菜馆|酒吧|奶茶|面包|蛋糕|面馆|米粉|自助|食堂)$/;
const SKIP_ADDRESS_LINE = /^(?:https?:|#小程序|★|☆|¥|￥|电话|手机|联系|营业|人均|评分|推荐|点击|复制)/;
// 店名常和一句宣传语挤在同一行（「【某店】快来试试这家餐厅吧！」），这种行绝不能当地址。
const CTA_LINE = /(快来|试试|打卡|推荐|值得|好评|人气|正宗|地道|网红|探店)/;
const PHONE_ONLY_LINE = /^[\d\s+\-()（）]{7,}$/;

function textAddress(text: string) {
  // 链接及其后面的一切都不是地址正文。
  const body = text.split(/https?:\/\//)[0] || text;
  const lines = body.split(/\n/)
    .map((line) => line.trim().replace(/^[【\[]|[】\]]$/g, "").trim())
    .filter(Boolean);

  // 带「地址：」前缀的行最可信，先整段找一遍。
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const labelled = lines[i].match(/^(?:地址|详细地址|位置|地点)\s*[:：]\s*(.+)$/);
    if (labelled) return labelled[1].trim();
  }

  const usable = (line: string) => !SKIP_ADDRESS_LINE.test(line) && !CTA_LINE.test(line)
    && !CUISINE_TAIL.test(line) && !PHONE_ONLY_LINE.test(line)
    && line.length >= 3 && line.length <= 60;

  // 点评把地址放在评分、人均、商圈之后，也就是最后 —— 从后往前找。
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (usable(lines[i]) && ADDRESS_STRONG.test(lines[i])) return lines[i];
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (usable(lines[i]) && /\d/.test(lines[i]) && ADDRESS_WEAK.test(lines[i])) return lines[i];
  }
  return "";
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
  if (host === "maps.apple.com") return "苹果地图";
  for (const [domain, name] of HOST_PLATFORMS) if (isHost(host, domain)) return name;
  return "网页链接";
}

// 平台名**不能只看域名**：`dpurl.cn` 是美团系短链，美团与大众点评的分享都会出现它。
// 线上真实数据（2026-10-02）：「…@美团 http://dpurl.cn/AbE4HrAz」被旧逻辑一律标成「大众点评」，
// 详情页于是显示「查看大众点评来源」—— 这就是用户报的歧义。判定顺序：文案里的显式标记 > 域名 >
// 判不出（返回 ""，由调用方显示中性文案，绝不猜）。
// 详情页也用这个函数**按链接+文案现算**，因此改这里能一并纠正库里已有的错标数据。
export function detectSourcePlatform(input: { url?: string | null; text?: string | null; fallback?: string }) {
  if (TEXT_PLATFORM.test(input.text || "")) return "美团";
  if (/(?:@|来自|via)\s*大众点评/.test(input.text || "")) return "大众点评";
  const raw = input.url || "";
  if (!raw) return input.fallback || "";
  let host = "";
  try { host = new URL(raw).hostname.toLowerCase(); } catch { host = ""; }
  // 有链接但域名认不出（dpurl.cn 这类两平台共用的短链）→ 不猜，交给调用方给中性文案。
  if (!host) return "";
  const named = sourceName(host);
  return named === "网页链接" ? "" : named;
}

export function resolveSharedText(input: string): ResolvedPlace {
  const raw = input.trim().slice(0, 3000);
  const fields = bracketFields(raw);
  const texted = textAddress(raw);
  const mini = raw.match(/#小程序:\/\/([^\s\n]+)/);
  if (mini) {
    const name = fields.names[0] || sharedName(raw.slice(0, mini.index));
    return {
      name, address: fields.address || texted, lat: null, lng: null, sourceUrl: null,
      sourcePlatform: "微信小程序",
      message: name ? "已从分享文案提取名称。小程序口令不含公开坐标。" : "已识别微信小程序口令。口令本身不含店名和位置，请补填名称和地址。",
    };
  }

  const match = raw.match(URL_RE);
  if (!match) {
    const name = fields.names[0] || raw.split(/[\n，,]/)[0]?.slice(0, 80) || "";
    return { name, address: fields.address || texted, lat: null, lng: null, sourceUrl: null, sourcePlatform: "手动输入", message: "请确认名称和地址。" };
  }

  let url: URL;
  try { url = new URL(match[0].replace(/[.,;!?]+$/, "")); } catch {
    return { name: "", address: "", lat: null, lng: null, sourceUrl: null, sourcePlatform: "网页链接", message: "链接格式无法识别，请手动填写。" };
  }
  const host = url.hostname.toLowerCase();
  const platform = detectSourcePlatform({ url: url.toString(), text: raw }) || "网页链接";
  const params = url.searchParams;
  let name = params.get("name") || params.get("title") || params.get("q") || "";
  // 地址优先用链接参数；短链没有参数时回退到【地址：…】分段，再退到文案里的裸地址行。
  const address = params.get("address") || fields.address || texted;
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
    message: point ? "已从地图链接识别地点和坐标，请核对后保存。" : "已保存来源链接。请核对店名、地址。",
  };
}
