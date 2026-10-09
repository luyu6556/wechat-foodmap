import { env } from "cloudflare:workers";
import { gcjToWgs } from "./resolve";
// 判据全部抽到 geo-match.ts 的纯模块里：这个文件顶层 import 了 cloudflare:workers，
// 判据留在里面就永远没法 node --test，前端组件也引用不了（名称校正要用的 nameVariant）。
import { addressArbitrated, addressCorroborated, asText, baseOf, branchEvidence, branchOf, matchStrength } from "./geo-match";

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

// place/text 对任何关键词都会返回结果，必须拿名字复核（见 geo-match 的 matchStrength）。
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

// 高德 place/text 即使在 extensions=base 下也会给 type（如「交通设施服务;停车场;公共停车场」）。
// 字段一律按 unknown 收，再交给 asText 归一 —— 高德缺地址时给的是数组 `[]` 而不是空串
// （实测：点评 29 号「电白鸭粥店(宝民二路店)」这条 POI 的 address 就是 `[]`）。
type AmapPoi = { name?: unknown; address?: unknown; location?: unknown; type?: unknown };
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

// 「停车场」「出入口」类 POI 的名字里也带店名，会挤掉真正的餐厅 POI。
// 实测（35 号「金泰食府（竹园店）」）：唯一名称吻合的 POI 是「金泰食府(竹园店)地上停车场」
// （type=`交通设施服务;停车场;公共停车场`），真正那家叫「金泰燕翅鲍」——名字对不上主体名，
// 会被 matchStrength 判成 none 挡掉，于是「停车场」成了唯一选择。十米误差本身不致命，但详情会显示
// 「已定位到…地上停车场」，用户会以为定位错了。按高德给的 type 排除，宁可不定位也不给错名字。
// 判据用 type 而非名字：名字里出现「停车场」也可能是别的说法，type 是结构化的、不会漂。
const PARKING_TYPE_WORDS = ["停车场", "停车楼", "出入口"];

function isParkingPoi(item: AmapPoi) {
  const type = asText(item.type);
  return PARKING_TYPE_WORDS.some((word) => type.includes(word));
}

// 一条候选，外加「它凭什么被收下」。这两件事必须分开存：名字只能说明「可能是同一个品牌」，
// 地址才能说明「是同一处」。旧版把两者揉成一个布尔（nameMatches 一过就采用），于是高德拿品类词
// 凑出来的店也能直接定图钉 —— 2026-10-08 的「小火璽 → 润园四季椰子鸡火锅」就是这么错到十几公里外的。
type ScoredHit = {
  hit: PlaceCandidate;
  strength: "strong" | "weak" | "none";
  addressCorroborated: boolean;
  // 分店证据的三态（见 geo-match 的 branchEvidence）：verified 是强证据，mismatch 是反证。
  branch: "verified" | "absent" | "mismatch";
  // 来自「地址反查」那条补充检索（见 recallByAddress）。它只证明地址对得上，
  // 没证明是同品牌的那家店 —— 所以永远不许直接采用，只能进候选让用户点。
  recalled: boolean;
};

// 能不能不打扰用户、直接把图钉定下来。四条路任意一条走通即可，但**反证优先**：
//   ⓪ 分店名明确对不上（mismatch）→ 直接否掉。文案写「深圳总店」、候选是「古城店」，
//      主体名再像也不是同一家（实测：美团 33 号那家就是靠这条被正确挡住的）。
//   ① 分店名明确对上了（verified）→ 采用。同品牌 + 同分店是很强的证据，比名字相似度可靠。
//   ② 主体名强命中 → 采用（老行为）。
//   ③ 地址对得上门牌级证据 → 采用。「品类词能骗过名字，骗不过门牌号」——这条是 2026-10-08
//      「小火璽 → 润园四季椰子鸡火锅」错点位的正解：那家的名字重合率 0.714 过了旧门槛，
//      但地址在罗湖、和文案的南山地址对不上，于是不再被采用。
// 另外，地址反查找回来的候选一律不许直接采用（它只有地址证据，没验证过是不是同一家店）。
function isAdoptable(item: ScoredHit) {
  if (item.recalled) return false;
  if (item.branch === "mismatch") return false;
  return item.branch === "verified" || item.strength === "strong" || item.addressCorroborated;
}

// 候选列表的排序：能采用的排最前，然后分店对上的、主体名强的、地址佐证的依次往前。
function byLikelihood(a: ScoredHit, b: ScoredHit) {
  return Number(isAdoptable(b)) - Number(isAdoptable(a))
    || Number(b.branch === "verified") - Number(a.branch === "verified")
    || Number(b.strength === "strong") - Number(a.strength === "strong")
    || Number(b.addressCorroborated) - Number(a.addressCorroborated);
}

// wantText = 文案里的店名 + 地址，供 branchMatches 做反向比对（候选分店名可能只写在文案地址里）。
// address 单独收：地址佐证要拿它和候选地址比，不能混进 wantText 里。
function collectHits(results: AmapPoi[], wanted: string, address: string): ScoredHit[] {
  const wantedBase = baseOf(wanted);
  const wantedBranch = branchOf(wanted);
  const wantText = `${wanted}${address}`;
  const hits: ScoredHit[] = [];
  for (const item of results) {
    const name = asText(item.name);
    const parsed = parseLocation(asText(item.location));
    if (!name || !parsed) continue;
    if (isParkingPoi(item)) continue;
    const itemAddress = asText(item.address);
    // 只比主体名：分店差异放到 exactBranch 单独判，用来决定「能不能直接采用」。
    // 弱命中**照样收**（否则「换了个措辞的同一家」会整批漏掉），能不能采用留给 isAdoptable。
    const strength = matchStrength(wantedBase, baseOf(name));
    if (strength === "none") continue;
    const [lat, lng] = gcjToWgs(parsed[0], parsed[1]);
    const corroborated = addressCorroborated(address, itemAddress);
    const branch = branchEvidence(wantedBranch, name, itemAddress, wantText);
    hits.push({
      hit: {
        name,
        address: itemAddress,
        lat,
        lng,
        // 对外的 exactBranch 保持旧语义：只有「分店名明确对不上」才是 false。
        exactBranch: branch !== "mismatch",
      },
      strength,
      addressCorroborated: corroborated,
      branch,
      recalled: false,
    });
  }
  return hits;
}

// 地址反查：名字这条路走不通时（识别把品类词并进店名、或高德登记名和文案名差得远），
// 拿地址再搜一轮。**筛选门槛只有地址佐证** —— 名字正是这里不可信的那一侧，不能再拿它过滤，
// 否则「小火璽」永远进不了候选（它的名字重合率只有 2/7）。
// 代价是每次多一次 REST 调用，所以只在意向失败时才跑（见 recallIfNeeded）。
async function recallByAddress(wanted: string, address: string, city: string): Promise<ScoredHit[]> {
  const poi = await amapJson("/place/text", {
    keywords: address, city, offset: String(POI_PAGE_SIZE), page: "1", extensions: "base",
  });
  const wantedBase = baseOf(wanted);
  const wantedBranch = branchOf(wanted);
  const wantText = `${wanted}${address}`;
  const recalled: ScoredHit[] = [];
  for (const item of (poi.pois || []) as AmapPoi[]) {
    const name = asText(item.name);
    const parsed = parseLocation(asText(item.location));
    if (!name || !parsed) continue;
    if (isParkingPoi(item)) continue;
    const itemAddress = asText(item.address);
    if (!addressCorroborated(address, itemAddress)) continue;
    const [lat, lng] = gcjToWgs(parsed[0], parsed[1]);
    const branch = branchEvidence(wantedBranch, name, itemAddress, wantText);
    recalled.push({
      hit: {
        name,
        address: itemAddress,
        lat,
        lng,
        exactBranch: branch !== "mismatch",
      },
      strength: matchStrength(wantedBase, baseOf(name)),
      addressCorroborated: true,
      branch,
      recalled: true,
    });
  }
  return recalled;
}

// 只在这两种情况之外才多花一次地址反查：
//   · 一条命中都没有 —— 老路径会用地址解析（geocode/geo）给一个图钉；改成让用户挑候选会把
//     「自动命中」变少（实测基线：美团 33/40、点评 36/41、截图 44/49），那是另一种倒退。
//   · 已经有且只有一条能采用 —— 这条路径后面就直接早返回了，搜了也白搜。
// 于是触发面只剩「有命中、但一条都采用不了」—— 正是「小火璽」那类「名字被品类词污染」的形态。
async function recallIfNeeded(hits: ScoredHit[], name: string, address: string, city: string) {
  if (!address || !hits.length) return [];
  if (hits.filter(isAdoptable).length === 1) return [];
  return await recallByAddress(name, address, city);
}

// 两批候选按「店名 + 坐标」去重：同一家店在两次检索里都会返回。
function mergeHits(primary: ScoredHit[], extra: ScoredHit[]) {
  const seen = new Set(primary.map((item) => `${item.hit.name}|${item.hit.lat}|${item.hit.lng}`));
  const merged = [...primary];
  for (const item of extra) {
    const key = `${item.hit.name}|${item.hit.lat}|${item.hit.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.sort(byLikelihood);
}

async function amapLocate(name: string, address: string, city: string): Promise<GeocodeResult> {
  let hits: ScoredHit[] = [];
  if (name) {
    // 先按全名查（含分店后缀）：实测「山葵烤肉by SHANKUI BBQ(东园路2号店)」在高德只返回 1 条，
    // 正是东园路那家。全名查不到再退回主体名，覆盖点评和高德分店写法不一致的情况。
    let poi = await amapJson("/place/text", {
      keywords: name, city, offset: String(POI_PAGE_SIZE), page: "1", extensions: "base",
    });
    hits = collectHits((poi.pois || []) as AmapPoi[], name, address);
    const base = name.replace(/[（(][^（()）]*[)）]\s*$/, "").trim();
    if (!hits.length && base && base !== name) {
      poi = await amapJson("/place/text", {
        keywords: base, city, offset: String(POI_PAGE_SIZE), page: "1", extensions: "base",
      });
      hits = collectHits((poi.pois || []) as AmapPoi[], name, address);
    }
  }

  // 名字这条路走不通时，再用地址补一批候选（见 recallByAddress）。合并后统一排序。
  hits = mergeHits(hits, await recallIfNeeded(hits, name, address, city));

  const adoptable = hits.filter(isAdoptable);
  if (adoptable.length === 1) {
    // 唯一一家名字和分店都对得上、且地址也站得住 —— 直接采用，不打扰用户。
    const { hit } = adoptable[0];
    return {
      lat: hit.lat, lng: hit.lng, source: "poi", confidence: POI_CONFIDENCE,
      matchedName: hit.name, candidates: [],
      message: `已按店名定位到「${hit.name}」，请核对图钉位置。`,
    };
  }

  // 多条都「可采用」→ 名字这一侧已经分不开了（同名连锁：实测「电白鸭粥店」全市 26 家），
  // 改用门牌级地址佐证定音（见 geo-match 的 addressArbitrated）。只在**恰好一条**满足时采用。
  if (adoptable.length > 1) {
    const arbitrated = addressArbitrated(hits);
    if (arbitrated) {
      const { hit } = arbitrated;
      return {
        lat: hit.lat, lng: hit.lng, source: "poi", confidence: POI_CONFIDENCE,
        matchedName: hit.name, candidates: [],
        message: `已按店名与门牌级地址比对定位到「${hit.name}」，请核对图钉位置。`,
      };
    }
  }

  if (hits.length) {
    // 三种情况都落到这里：多家精确命中、只找到同品牌的其他分店、以及「名字对得上但地址不佐证」
    // （小火璽那类）。「选第一家」在三种情况下都是错的，所以一律交给用户挑。
    return {
      lat: null, lng: null, source: "none", confidence: 0, matchedName: "",
      candidates: hits.slice(0, POI_PAGE_SIZE).map((item) => item.hit),
      message: adoptable.length > 1
        ? "找到多家同名的店，请选择正确的那家。"
        : "没能确定到唯一一家（店名或地址对不上），下面是可能的门店；都不是就手动输入坐标。",
    };
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
