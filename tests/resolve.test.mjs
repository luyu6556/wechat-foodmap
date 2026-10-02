import test from "node:test";
import assert from "node:assert/strict";
import { detectSourcePlatform, gcjToWgs, resolveSharedText, wgsToGcj } from "../lib/resolve.ts";

test("苹果地图收藏能预填名称、地址和 WGS84 点位", () => {
  const result = resolveSharedText("https://maps.apple.com/?name=亚朵见野酒店&address=深圳市南山区留仙大道2109号&coordinate=22.579873,113.946445");
  assert.equal(result.sourcePlatform, "苹果地图");
  assert.equal(result.name, "亚朵见野酒店");
  assert.equal(result.address, "深圳市南山区留仙大道2109号");
  assert.equal(result.lat, 22.579873);
  assert.equal(result.lng, 113.946445);
});

test("高德分享点位转换到统一坐标，回显可转换回来", () => {
  const result = resolveSharedText("https://uri.amap.com/marker?position=113.9520,22.5826&name=群友餐厅");
  assert.equal(result.sourcePlatform, "高德地图");
  assert.equal(result.name, "群友餐厅");
  assert.ok(result.lat && result.lng);
  const [lat, lng] = wgsToGcj(result.lat, result.lng);
  assert.ok(Math.abs(lat - 22.5826) < 0.0001);
  assert.ok(Math.abs(lng - 113.9520) < 0.0001);
});

test("点评小程序口令只从附带文案提名称，不猜坐标", () => {
  const result = resolveSharedText("巷子里的重庆小面\n#小程序://大众点评美食电影运动旅游门票/A8bd4qMWSBWQT1p");
  assert.equal(result.name, "巷子里的重庆小面");
  assert.equal(result.lat, null);
  assert.match(result.message, /选点/);
});

test("未知链接保留来源并要求选点，仿冒域名不会被标为美团", () => {
  const result = resolveSharedText("https://evilmeituan.com/poi/12");
  assert.equal(result.sourcePlatform, "网页链接");
  assert.equal(result.lat, null);
  assert.equal(result.sourceUrl, "https://evilmeituan.com/poi/12");
});

test("坐标正反转换精度满足地图点位显示", () => {
  const [lat, lng] = wgsToGcj(22.55, 114.06);
  const [restoredLat, restoredLng] = gcjToWgs(lat, lng);
  assert.ok(Math.abs(restoredLat - 22.55) < 0.0001);
  assert.ok(Math.abs(restoredLng - 114.06) < 0.0001);
});

test("美团短链分享文案：店名取【】首段，地址取【地址：】分段，电话不污染店名，来源是美团不是点评", () => {
  // 2026-10-01 用户提供的真实样例（dpurl.cn 短链，URL 参数里没有任何字段）
  const result = resolveSharedText(
    "【杨箕小馆·地道广州菜（番禺万博店）】快来试试这家餐厅吧！ 【地址：番禺区汉溪大道东386号晟潮C-WAVE-4层403】【电话：18928846589】@美团 http://dpurl.cn/C3BkQc4z",
  );
  assert.equal(result.name, "杨箕小馆·地道广州菜（番禺万博店）");
  assert.equal(result.address, "番禺区汉溪大道东386号晟潮C-WAVE-4层403");
  // dpurl.cn 是美团系短链、两平台共用，旧逻辑一律标成「大众点评」，详情页于是显示
  // 「查看大众点评来源」——文案里的 @美团 才是真来源（见 Q31）。
  assert.equal(result.sourcePlatform, "美团");
  assert.equal(result.sourceUrl, "http://dpurl.cn/C3BkQc4z");
  assert.equal(result.lat, null);
  assert.match(result.message, /选点/);
});

test("来源平台：文案标记 > 域名 > 判不出就不猜", () => {
  // 线上真实数据：库里的 sourcePlatform 被旧逻辑写成「大众点评」，但文案末尾是 @美团。
  assert.equal(detectSourcePlatform({
    url: "http://dpurl.cn/AbE4HrAz",
    text: "【大富烧鸡大牌档（红岭店）】快来试试这家餐厅吧！ 【地址：罗湖区红桂二街23号大院】【电话：19879400958】@美团 http://dpurl.cn/AbE4HrAz",
    fallback: "大众点评",
  }), "美团");
  // 点评域名 → 大众点评（文案里没有标记）。
  assert.equal(detectSourcePlatform({
    url: "https://m.dianping.com/shopinfo/G6Od940U9MovXrPa?msource=Appshare2021",
    text: "【坐下kitchen】\n★★★★☆ 4.6\n¥65/人\n八卦岭/园岭 美食\n园岭新村88栋109",
    fallback: "大众点评",
  }), "大众点评");
  // dpurl.cn 且文案里没有 @美团 → 两平台共用，判不出就不猜（详情页显示「查看原链接」）。
  assert.equal(detectSourcePlatform({ url: "http://dpurl.cn/xyz", text: "【某店】http://dpurl.cn/xyz", fallback: "大众点评" }), "");
  // 没有链接时用兜底值（截图识别 / 微信小程序都是我们自己写下的，可信）。
  assert.equal(detectSourcePlatform({ url: null, text: "", fallback: "截图识别" }), "截图识别");
  assert.equal(detectSourcePlatform({ url: null, text: "【某店】", fallback: "微信小程序" }), "微信小程序");
  // 正文里顺口提到「美团」不算来源（要求 @ 前缀）。
  assert.equal(detectSourcePlatform({ url: "https://m.dianping.com/shopinfo/x", text: "【某店】上过美团必吃榜", fallback: "" }), "大众点评");
});

test("点评分享文案没有【地址：】时，也能从裸地址行取到地址", () => {
  // 2026-10-01 用户真实样例：地址就是一行「东园大厦」，前面是评分、人均、商圈行。
  const result = resolveSharedText(
    "【山葵烤肉by SHANKUI BBQ(东园路2号店)】\n★★★★★ 4.8\n¥119/人\niN城市广场 融合烤肉\n东园大厦\nhttps://m.dianping.com/shopinfo/G2LJiikU53h5xvWR?msource=Appshare2021",
  );
  assert.equal(result.name, "山葵烤肉by SHANKUI BBQ(东园路2号店)");
  assert.equal(result.address, "东园大厦");
  assert.equal(result.sourcePlatform, "大众点评");
  assert.equal(result.lat, null);
});

test("商圈行和店名行不会被误当成地址", () => {
  // 「iN城市广场 融合烤肉」以「肉」结尾、「巷子里的重庆小面」以「面」结尾 —— 都不该是地址。
  const mall = resolveSharedText("【某烤肉店】\n★★★★★ 4.8\n¥119/人\niN城市广场 融合烤肉\nhttps://m.dianping.com/shopinfo/abc");
  assert.equal(mall.address, "");
  const shop = resolveSharedText("巷子里的重庆小面\n#小程序://大众点评/A8bd4qMWSBWQT1p");
  assert.equal(shop.address, "");
  assert.equal(shop.name, "巷子里的重庆小面");
});

test("点评地址以房号结尾时也能取到（首版按结尾词判会整条漏掉）", () => {
  // 2026-10-02 用户真实样例：地址末尾是房号「101-1」，不是「号/路/栋」。
  const result = resolveSharedText(
    "【Ice-key草台氷屋】\n★★★★☆ 4.6\n¥50/人\n八卦岭/园岭 冰淇淋\n红荔路园岭新村106栋101-1\nhttps://m.dianping.com/shopinfo/HaYrxeLVNGQqqUMb?msource=Appshare2021",
  );
  assert.equal(result.name, "Ice-key草台氷屋");
  assert.equal(result.address, "红荔路园岭新村106栋101-1");
  assert.equal(result.sourcePlatform, "大众点评");
});

test("没有强地址词时，靠「数字 + 门牌字」兜底", () => {
  const result = resolveSharedText("【某店】\n★★★★★ 4.8\n¥50/人\n海德二道3009号正东名苑\nhttps://m.dianping.com/shopinfo/x");
  assert.equal(result.address, "海德二道3009号正东名苑");
});

test("链接参数里的地址优先于文案分段", () => {
  const result = resolveSharedText(
    "【某店】宣传语 【地址：文案里的地址】 https://maps.apple.com/?name=某店&address=链接里的地址&coordinate=22.5,114.0",
  );
  assert.equal(result.name, "某店");
  assert.equal(result.address, "链接里的地址");
});
