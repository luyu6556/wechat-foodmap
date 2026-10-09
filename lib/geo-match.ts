// 定位判据的纯函数集合。
//
// 刻意不 import `cloudflare:workers` / `./resolve`：geo.ts 顶层依赖 Worker env，
// 只要判据还留在它里面就永远没法 `node --test`（一 import 就炸），判据也就没人钉得住。
// 抽到这里的另一个好处是前端组件能直接引用（名称校正的 nameVariant 就要在前端跑）。
//
// 这里只放**纯字符串判定**，所有网络调用、坐标系转换仍留在 lib/geo.ts。

// 高德 place/text 的字段**不保证是字符串**：缺地址时它给的是**空数组 `[]`**，不是空串
// （实测：点评 29 号「电白鸭粥店(宝民二路店)」这条 POI 的 address 就是 `[]`）。
// 直接拿去 .replace() 会抛 TypeError —— 旧代码恰好因为 branchMatches 在「文案无分店名」时
// 提前 return 而躲过了这一击，一旦有判据无条件读地址就会炸。所有来自高德的文本先过这里。
export function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// 「巴扎美食·新疆菜·西域歌舞表演餐厅(新疆大厦店)」 → 「巴扎美食新疆菜西域歌舞表演餐厅」
// 弯引号 ’‘ 也算标点：点评/美团的分享文案里几乎都是 ’（U+2019），不剥它的话「Emily’s Cafe」
// 和「Emily's Cafe」会判成两个不同的字符串（实测就撞上了这条）。
export function coreName(value: string) {
  return asText(value)
    .replace(/[（(][^（()）]*[)）]/g, "")
    .replace(/[\s·・\-–—~、,，.。!！?？:：'"“”’‘/\\|]/g, "")
    .toLowerCase();
}

// 分店后缀必须单独留下来：coreName 会把「(东园路2号店)」整段删掉，于是「(东园路2号店)」和「(南山店)」
// 变成同一个字符串，同名连锁的不同门店再也区分不开 —— 图钉会落到先返回的那家分店上。
// 只取末尾的括号：店名中间的括号不是分店后缀。
export function branchOf(value: string) {
  const match = value.match(/[（(]([^（()）]*)[)）]\s*$/);
  return match ? coreName(match[1]) : "";
}

// 去掉末尾分店后缀后的主体名。
export function baseOf(value: string) {
  return coreName(value.replace(/[（(][^（()）]*[)）]\s*$/, ""));
}

// 分店名去掉门牌号再比对：点评写「东园路2号店」、高德 POI 写「东园路3号」，是同一家店。
// 反过来「南山店」不会因此被当成东园路那家。
export function branchKey(value: string) {
  return coreName(value).replace(/[0-9a-z]+号?/g, "").replace(/店$/, "");
}

// 只去标点空白、**保留括号里的字**。coreName 会把括号整段删掉，而分店名恰恰常写在括号里
// （「新潮宝牛肉火锅店(圳通大厦店)」），所以做分店名的双向比对时不能用它 —— 这是 2026-10-08
// 实测里「金泰食府(竹园店)地上停车场」判不出来的直接原因。
export function plainText(value: string) {
  return asText(value).replace(/[\s·・\-–—~、,，.。!！?？:：'"“”’‘/\\|（）()]/g, "").toLowerCase();
}

// 最长公共子串长度。判断「是不是同一处」要比「是不是同一个品牌」硬得多：两家店如果连
// 「宝岗路100号」这种「路名 + 门牌」都一模一样，基本可以断定是同一处，哪怕高德给的分店名
// 和美团文案写的完全不同。用子串而不是整体相似度：地址的其余部分（区、街道、宣传语）本来
// 就该不一样，拉低整体相似度会让真正的同一家被误杀。
export function longestCommon(a: string, b: string) {
  if (!a || !b) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = prev[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    prev = current;
  }
  return best;
}

// 地址重合到这个长度才算「门牌级证据」。门槛取 5 是拿实测校准过的：
// 「宝岗路100号」7 字、命中；「笋岗东路」4 字、不命中（33 号那家 VGM 广场店就靠这条被正确挡住）。
export const ADDRESS_MATCH_MIN = 5;

// 最长公共子串的**本体**。只拿到长度不够用 —— 还要看这段公共内容到底是不是门牌号。
export function longestCommonText(a: string, b: string) {
  if (!a || !b) return "";
  let best = "";
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = prev[j - 1] + 1;
        if (current[j] > best.length) best = b.slice(j - current[j], j);
      }
    }
    prev = current;
  }
  return best;
}

// 「门牌级」证据必须带门牌号（阿拉伯或中文数字）。**只卡长度是不够的**：
// 2026-10-09 实测「文心五路33号海岸城购物中心5楼530商铺」对
// 「万丰中路245号万丰海岸城购物中心沙井南环路店F6层」，最长公共子串是「海岸城购物中心」
// 7 字，轻轻松松过了 5 字门槛 —— 可沙井那家和南山这家差了十几公里。它共享的是**商场名**，
// 不是门牌号。
// 反过来，真同一处的地址一定共享门牌号：「宝岗路100号」「同沙路新围村188栋底商」「田贝四路」
// （「四」是中文数字，同样算）。所以这里只认「公共片段里出现过数字」。
// 代价（已知且接受）：纯场所名的地址从此不算佐证 —— 但这条判据是**兜底**（①②③都不成立才跑），
// 收紧它最坏只是「少一次自动定位、多弹一次候选」，不会给出错误图钉。
export const ADDRESS_NUMERAL_RE = /[0-9一二三四五六七八九十]/;

export function houseLevelOverlap(a: string, b: string) {
  const shared = longestCommonText(a, b);
  return shared.length >= ADDRESS_MATCH_MIN && ADDRESS_NUMERAL_RE.test(shared);
}

// 「只看候选地址」判定需要的最短分店名。2 字的分店名常常本身就是行政区/街道名，而高德地址里
// 满地都是街道名 —— 实测回归：美团「先记烧鹅王·本地粤菜(福永店)」的分店名去掉后缀只剩「福永」，
// 而「福永」是宝安街道名，命中了同街道另一家分店「(立新湖酒楼)」的地址，于是从「唯一命中」
// 变成「找到多家同名的店」。落在**候选名**里的分店名不受此限（名字里有就是强证据，多短都算）。
export const ADDRESS_ONLY_KEY_MIN = 3;

// 主体名「弱命中」的字符集重合率门槛。沿用 2026-10-02 起就在用的 0.7，
// 语义变了：以前它单独就足以让一家店被收进候选并**直接采用**，现在只够进候选，
// 还必须叠加地址佐证才允许自动采用（见 lib/geo.ts 的 adoptable）。
export const NAME_WEAK_OVERLAP = 0.7;

// 名称校正里「差异小」的编辑距离上限。1 就是「只差一个字」，正对形近字错读
// （小楠记/小煵记、叫豪/叫嚎、繁楼/蘩楼）。
export const SMALL_NAME_EDIT = 1;

// 分店是否对得上。四条判据并列，任一成立即为同一家：
//   ① 文案的分店名出现在候选**名**里（保留括号，多短都算）
//   ② 文案的分店名出现在候选**地址**里（需 ≥3 字，见 ADDRESS_ONLY_KEY_MIN）
//   ③ 反向：候选的分店名出现在「文案店名 + 文案地址」里，或两侧分店名互相包含
//   ④ 两侧**地址**有 ≥5 字的共同片段（门牌级证据，兜底）
// 2026-10-08 实测背景：旧版只做 ① 的一个变体，而且用 coreName 处理候选（括号被删）、候选自带
// 分店后缀时又直接 return 不回退，导致 40 条美团样例里 13 条（32.5%）被判「没找到这家分店」。
// 判据**只放宽、不收紧**：分店信息缺失时仍按主体名算。
//
// 返回三态而不是布尔 —— 因为「分店名对上了」和「文案里压根没写分店」是两回事，
// 调用方需要分开处理（见 geo.ts 的 isAdoptable）：
//   absent   —— 文案里没有可用的分店信息。**没有证据**，只能退回主体名判断。
//   verified —— 有分店信息，且四条判据任一成立。**这是很强的证据**：同品牌 + 同分店，
//               足够支撑「不打扰用户、直接采用」（实测：文案「四方面荘(常丰花园店)」↔高德
//               「四方面庄(常丰花园店)」，主体名只差一个异体字，靠它才敢定图钉）。
//   mismatch —— 有分店信息但一条都不成立。**这是反证**，不是「信息缺失」：文案写「深圳总店」、
//               候选是「古城店」，那就不是同一家，绝不能因为主体名像就采用。
export function branchEvidence(wanted: string, candidateName: string, candidateAddress: string,
  wantText: string): "verified" | "absent" | "mismatch" {
  const wantedKey = branchKey(wanted);
  if (!wantedKey) return "absent"; // 输入里没有可用的分店信息，只按主体名算。

  const candidateBranch = branchOf(candidateName);
  const candidateKey = candidateBranch ? branchKey(candidateBranch) : "";
  const candidateNamePlain = plainText(candidateName);
  const candidateAddressPlain = plainText(candidateAddress);
  // 文案侧（店名 + 地址）统一去掉标点空白，且**保留括号**：分店名常写在括号里。
  const wantSide = plainText(wantText);

  if (candidateNamePlain.includes(wantedKey)) return "verified";
  // 高德的 POI 名常常不带分店后缀，分店信息只出现在地址里（实测：「山葵烤肉by SHANKUI BBQ」
  // 这条 POI 名字没有括号，地址却是「东园路3号…」；「威记肠粉王(木头龙店)」的地址是
  // 「华丽路翠华花园8栋」）。但短 key 不许只靠地址成立，理由见 ADDRESS_ONLY_KEY_MIN。
  if (wantedKey.length >= ADDRESS_ONLY_KEY_MIN && candidateAddressPlain.includes(wantedKey)) {
    return "verified";
  }
  // 反向：候选的分店名写在文案的店名或地址里（美团写「翠竹店」、高德写「圳通大厦店」，
  // 而文案地址里正好有「圳通大厦」）。
  if (candidateKey && wantSide.includes(candidateKey)) return "verified";
  if (candidateKey && (candidateKey === wantedKey || candidateKey.includes(wantedKey)
    || wantedKey.includes(candidateKey))) return "verified";

  // 兜底：地址撞到门牌级证据。注意这里**只比地址**，且要求公共片段带门牌号（见 houseLevelOverlap）——
  // 「宝岗路100号」算同一处，「笋岗东路」只是同一条路，而「海岸城购物中心」只是同一个商场名。
  return houseLevelOverlap(wantSide, candidateAddressPlain) ? "verified" : "mismatch";
}

// 兼容布尔调用的包装：只有 mismatch 才算「不是这家」。
export function branchMatches(wanted: string, candidateName: string, candidateAddress: string,
  wantText: string) {
  return branchEvidence(wanted, candidateName, candidateAddress, wantText) !== "mismatch";
}

// 主体名的比对强度。分级而不是布尔：调用方要按强度决定「能不能不打扰用户直接采用」。
//   strong —— 完全一致，或一方完整包含另一方（「小火璽」⊃「小火璽」、品牌名带/不带后缀）
//   weak   —— 去掉重复字后的字符集重合率 ≥0.7
//   none   —— 其他，直接丢掉
//
// ⚠️ weak 之所以不够用，是因为这条判据**既不管顺序、也不剥品类词**。2026-10-08 的实测：
// 截图识别把「小火璽」读成「小火雲椰子鸡火锅」（品类词被并进店名），它与高德
// 「润园四季椰子鸡火锅」的重合率是 5/7 = 0.714 —— 刚好过线，于是被收进候选并**直接采用**，
// 图钉落到十几公里外的罗湖；而真正的高德 POI「小火璽」只重合 2/7 = 0.286，连候选都进不去。
// 结论：weak 只能用来「别漏掉」，不能用来「拍板」——还要叠加地址佐证。
export function matchStrength(recognized: string, candidate: string): "strong" | "weak" | "none" {
  const wanted = coreName(recognized);
  const found = coreName(candidate);
  if (!wanted || !found) return "none";
  if (wanted === found || wanted.includes(found) || found.includes(wanted)) return "strong";
  const pool = new Set(found);
  const hit = [...new Set(wanted)].filter((char) => pool.has(char)).length;
  return hit / new Set(wanted).size >= NAME_WEAK_OVERLAP ? "weak" : "none";
}

// 兼容旧调用点的布尔包装（geo.ts 里只比主体名那一处）。
export function nameMatches(recognized: string, candidate: string) {
  return matchStrength(recognized, candidate) !== "none";
}

// 行政区前缀。去掉它之后剩下的才是「路 + 门牌 + 楼栋」，也才是能区分两家店的证据。
// 不去掉的后果很实在：深圳的地址几乎都以「深圳市南山区」开头，光这一段就有 6 个字，
// 任意两条同区地址都能拿到 ≥5 字命中，地址佐证就形同虚设了。
// 尾部带上「办事处/办」是为了吃掉「福永街道办凤塘大道1号」里的「办」，别让它留在街巷段里。
const ADMIN_PREFIX_RE = /^[\u4e00-\u9fa5]{1,7}?(?:省|市|区|县|旗|镇|乡|街道|自治区|特别行政区)(?:办事处|办)?/;

// 「创业路1777号海信南方大厦3层02户」—— 剥掉省/市/区/街道，逐层剥（省→市→区→街道），
// 上限 6 层足够覆盖「广东省深圳市宝安区福永街道」这种最长写法。
// 可能剥成空串（地址本身就只是个行政区名），那说明它本来就没有任何门牌级信息，
// **不要**退回原文 —— 退回等于让「深圳市南山区」这种 6 字公共前缀重新变成假证据。
export function addressCore(value: string) {
  let rest = plainText(value);
  for (let step = 0; step < 6; step += 1) {
    const matched = rest.match(ADMIN_PREFIX_RE);
    if (!matched) break;
    rest = rest.slice(matched[0].length);
  }
  return rest;
}

// 地址佐证：两侧地址在**街巷层**有 ≥5 字、**且带门牌号**的共同片段才算。
// 这是 weak 命中能否自动采用的**第二个必要条件**，也是「不加品类词黑名单」的兜底 ——
// 品类词可以骗过名字，但骗不过门牌号。
export function addressCorroborated(address: string, candidateAddress: string): boolean {
  if (!address || !candidateAddress) return false;
  const a = addressCore(address);
  const b = addressCore(candidateAddress);
  // 剥完前缀后短于门槛的一侧根本没有可比内容，直接不算证据（否则「深圳市南山区」对
  // 「深圳市南山区」都会命中 6 字）。
  if (a.length < ADDRESS_MATCH_MIN || b.length < ADDRESS_MATCH_MIN) return false;
  return houseLevelOverlap(a, b);
}

// 定位仲裁：同名连锁靠**主体名**根本分不开 —— 实测「电白鸭粥店」全市 26 家，站点只取前 5 条
// 就全是 strong；文案名不带分店后缀（branch = absent），名字这一侧已经用尽。
// 这时唯一能定音的是**门牌级地址佐证**，但必须**恰好落在一条**候选上，否则宁可不选：
// 两条以上地址都能对上，说明连地址都分不开，那仍然该交用户挑。
//
// ⚠️ 它接受地址反查找回来的候选（recalled）。那条恰恰是唯一能对上门牌号的 ——
// 实测「电白鸭粥店」的正身就在反查结果里（地址「西丽街道同沙路新围村188栋底商」与文案近乎
// 逐字相同），却被「recalled 一律不许采用」和 `candidates.slice(0, 5)` 双重挡在用户视野之外，
// 用户连点都点不到。仲裁是它唯一的出口，所以这里不排除 recalled。
export type AddressSupport = { addressCorroborated: boolean; branch: string; strength: string };

export function addressArbitrated<T extends AddressSupport>(hits: readonly T[]): T | null {
  const supported = hits.filter((item) => item.addressCorroborated
    && item.branch !== "mismatch" && item.strength !== "none");
  return supported.length === 1 ? supported[0] : null;
}

// Levenshtein 距离，只用于「差一个字」这一档判断，字符串都很短（店名 ≤ 80 字）。
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(prev[j] + 1, current[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = current;
  }
  return prev[b.length];
}

// 识别名与高德登记名的差异分级，决定「要不要自动改名」：
//   same —— 一致，什么都不做
//   near —— 差一个字，或一方包含另一方 → **自动改成高德登记名**并给一句提示
//   far  —— 差异过大 → 只提示、不改名，避免把用户不认识的店名硬换上来
// 高德登记名是形近字错读的最佳兜底：煵/璽/蘩/嚎 这几个字高德登记的都是正确写法，
// 定位命中后用它的名字覆盖展示名，顺带还治了繁简。
export function nameVariant(recognizedName: string, candidateName: string): "same" | "near" | "far" {
  const a = coreName(recognizedName);
  const b = coreName(candidateName);
  if (!a || !b) return "far";
  if (a === b) return "same";
  if (a.includes(b) || b.includes(a)) return "near";
  if (Math.abs(a.length - b.length) <= SMALL_NAME_EDIT && editDistance(a, b) <= SMALL_NAME_EDIT) {
    return "near";
  }
  return "far";
}
