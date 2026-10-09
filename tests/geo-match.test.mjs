import test from "node:test";
import assert from "node:assert/strict";
import {
  addressCorroborated,
  addressCore,
  asText,
  branchEvidence,
  branchMatches,
  coreName,
  editDistance,
  matchStrength,
  nameMatches,
  nameVariant,
  plainText,
} from "../lib/geo-match.ts";

// 这组测试守的是 2026-10-08 截图实测暴露的缺陷：
// 识别把「小火璽」读成「小火雲椰子鸡火锅」，旧判据（去重字符集重合率 ≥0.7）判它和高德
// 「润园四季椰子鸡火锅」是同一家（5/7 = 0.714），于是静默采用了一个十几公里外的错点位。
// 每条判据都写**形态**而不是枚举观测值，并且**必带对照组** —— 只测命中会让判据退化成
// 「全部放行」也照样全绿（旧版就是这么漏的）。

// ── matchStrength ───────────────────────────────────────────────────────────

test("matchStrength：完全一致与互相包含都算强命中", () => {
  assert.equal(matchStrength("小煵记", "小煵记"), "strong");
  assert.equal(matchStrength("蜜雪冰城", "蜜雪冰城(深圳南山店)"), "strong");
  // 大小写、空格、间隔号一律归一后再比
  assert.equal(matchStrength("萨莉亚 Saizeriya", "萨莉亚Saizeriya"), "strong");
  assert.equal(matchStrength("巴扎美食·新疆菜(新疆大厦店)", "巴扎美食新疆菜"), "strong");
});

test("matchStrength：一字之差的换措辞算弱命中", () => {
  // 形态：品牌名相同、收尾用词不同（店/城、火锅/店、油条/省略）
  assert.equal(matchStrength("潮汕牛肉火锅店", "潮汕牛肉火锅城"), "weak");
  assert.equal(matchStrength("桃园眷村豆浆油条", "桃园眷村豆浆店"), "weak");
  assert.equal(matchStrength("陈记顺和牛肉火锅", "陈记顺和牛肉店"), "weak");
});

test("matchStrength：品类词污染判弱命中（不许判强）", () => {
  // 「椰子鸡火锅」这 5 个字对任何椰子鸡店都成立，所以不同店也会重合到 0.7 以上。
  // 它只能进候选，能不能采用交给地址佐证 —— 这正是没有引入品类词黑名单的替代方案。
  assert.equal(matchStrength("小火雲椰子鸡火锅", "润园四季椰子鸡火锅"), "weak");
});

test("matchStrength：真·不同店判不命中", () => {
  assert.equal(matchStrength("巴扎美食新疆菜西域歌舞表演餐厅", "清真新疆大巴扎美食"), "none");
  assert.equal(matchStrength("点都德", "陶陶居"), "none");
});

test("matchStrength 对照组：正确的高德 POI 也可能判不命中，说明判据不是全放行", () => {
  // 这条是「小火璽」事故的另一半：真身 POI 名字只有 3 个字，重合率 2/7 = 0.286，
  // 连候选都进不去。判据必须承认这个事实（靠 Step 1b 的地址反查去捞），
  // 而不是把门槛降到「全部放行」来蒙混过去。
  assert.equal(matchStrength("小火雲椰子鸡火锅", "小火璽"), "none");
  assert.equal(nameMatches("小火雲椰子鸡火锅", "润园四季椰子鸡火锅"), true);
  assert.equal(nameMatches("小火雲椰子鸡火锅", "小火璽"), false);
});

// ── addressCorroborated ─────────────────────────────────────────────────────

test("addressCorroborated：门牌级公共片段算佐证（前缀有无都行）", () => {
  assert.equal(
    addressCorroborated("创业路1777号海信南方大厦3层02户", "广东省深圳市南山区创业路1777号海信南方大厦"),
    true,
  );
  assert.equal(
    addressCorroborated("深圳市宝安区宝岗路100号", "宝岗路100号宝安广场2层"),
    true,
  );
});

test("addressCorroborated：只同一条路、门牌不同不算佐证", () => {
  assert.equal(addressCorroborated("深圳市南山区海德三道3009号", "深圳市南山区海德二道1008号海岸城"), false);
  assert.equal(addressCorroborated("深圳市罗湖区笋岗东路", "深圳市罗湖区宝安北路1002号"), false);
});

test("addressCorroborated 对照组 A：同区不同地不该被行政区前缀蹭中", () => {
  // 不去掉「深圳市南山区」这一段的话，两条地址的公共子串永远是 6 字 ≥ 门槛，
  // 地址佐证就形同虚设（这是实现时真踩到的坑，所以留成回归用例）。
  assert.equal(addressCorroborated("深圳市南山区创业路1777号海信南方大厦", "深圳市南山区科技园路1号A座"), false);
  assert.equal(addressCorroborated("深圳市南山区", "深圳市南山区"), false);
});

test("addressCorroborated 对照组 B：跨区/空地址一律不算", () => {
  assert.equal(addressCorroborated("深圳市南山区创业路1777号", "深圳市罗湖区人民南路1002号"), false);
  assert.equal(addressCorroborated("", "创业路1号"), false);
  assert.equal(addressCorroborated("创业路1号", ""), false);
});

test("addressCore 剥掉省/市/区/街道，剥空就返回空串", () => {
  assert.equal(addressCore("深圳市南山区创业路1777号"), "创业路1777号");
  assert.equal(addressCore("广东省深圳市宝安区福永街道办凤塘大道1号"), "凤塘大道1号");
  assert.equal(addressCore("深圳市南山区"), "");
  // 没有行政区前缀的地址原样保留（别把路名当成区名剥掉）
  assert.equal(addressCore("创业路1777号海信南方大厦"), "创业路1777号海信南方大厦");
});

// ── nameVariant ─────────────────────────────────────────────────────────────

test("nameVariant：一字之差判 near，可自动改用高德登记名", () => {
  // 就是四个真错字里的三个（煵/嚎/蘩），加两个结构不同的形态：
  // 同长替换（禄/录）与少一个字（删「火」）。
  assert.equal(nameVariant("小楠记", "小煵记"), "near");
  assert.equal(nameVariant("叫豪", "叫嚎"), "near");
  assert.equal(nameVariant("繁楼", "蘩楼"), "near");
  assert.equal(nameVariant("禄鼎记", "禄鼎录"), "near");
  assert.equal(nameVariant("牛大吉牛肉火锅", "牛大吉牛肉锅"), "near");
});

test("nameVariant 边界：差两个字判 far，只提示不自动改名", () => {
  // 6 字公共前缀、尾巴差两个字（火锅→店）—— 看着像同一品牌，但已经超出「差一个字」，
  // 按「差异小自动改、差异大提示」的分工只给提示，改名权交回用户。
  assert.equal(nameVariant("陈记顺和牛肉火锅", "陈记顺和牛肉店"), "far");
});

test("nameVariant：一致与互相包含", () => {
  assert.equal(nameVariant("小煵记", "小煵记"), "same");
  assert.equal(nameVariant("先记烧鹅王·本地粤菜(福永店)", "先记烧鹅王"), "near");
});

test("nameVariant：差异过大判 far，只提示不自动改名", () => {
  assert.equal(nameVariant("小火雲椰子鸡火锅", "小火璽"), "far");
  assert.equal(nameVariant("深圳湾万象城海底捞", "海底捞智慧餐厅"), "far");
});

test("nameVariant 对照组：真·不同店判 far，空名字不会误判成 near", () => {
  assert.equal(nameVariant("点都德", "陶陶居"), "far");
  assert.equal(nameVariant("", "小煵记"), "far");
  assert.equal(nameVariant("小煵记", ""), "far");
});

test("editDistance：只差一个字就是 1，增删也算 1", () => {
  assert.equal(editDistance("小楠记", "小煵记"), 1);
  assert.equal(editDistance("小煵记", "小煵记"), 0);
  assert.equal(editDistance("小煵记", "小煵记店"), 1);
});

// ── branchEvidence（守住 2026-10-08 的分店判据修复，别在本次改动里被带坏）────────

test("branchEvidence：文案里没有分店信息 → absent（没有证据，不等于对上）", () => {
  // 传入的 wanted 是**分店名**（geo.ts 传的是 branchOf(店名)），为空就是压根没写分店。
  assert.equal(branchEvidence("", "任意店", "任意地址", ""), "absent");
  // 「2号店」去掉门牌号后什么都不剩，同样没有信息量。
  assert.equal(branchEvidence("2号店", "任意店", "任意地址", "任意店2号店"), "absent");
});

test("branchEvidence：分店名对上 → verified（三种形态）", () => {
  // ① 文案分店名写在候选名里（多短都算）
  assert.equal(branchEvidence("福永店", "先记烧鹅王(福永店)", "", "先记烧鹅王福永店"), "verified");
  // ② 分店名只出现在候选地址里（≥3 字才算）
  assert.equal(branchEvidence("圳通大厦店", "新潮宝牛肉火锅店", "深圳市罗湖区东门中路2088号圳通大厦", ""), "verified");
  // ③ 两侧分店名互相包含（文案「半岛城邦店」/ 高德「半岛·城邦二期店」）
  assert.equal(
    branchEvidence("半岛城邦店", "Emily's Cafe(半岛·城邦二期店)", "金世纪路半岛城邦2期7号", "Emily’s Cafe(半岛城邦店)金世纪路2-7号"),
    "verified",
  );
});

test("branchEvidence：分店名对不上 → mismatch（是反证，不是信息缺失）", () => {
  assert.equal(branchEvidence("深圳总店", "牛百鲜·牛腩煲火锅(古城店)", "", "牛百鲜牛腩煲·牛肉火锅(深圳总店)"), "mismatch");
  assert.equal(branchEvidence("东园路2号店", "山葵烤肉(南山店)", "", "山葵烤肉东园路2号店"), "mismatch");
});

test("branchEvidence：2 字分店名不许只靠候选地址成立（福永是街道名的那个坑）", () => {
  // 「福永」既是分店名也是宝安街道名，靠地址成立会把同街道另一家分店也放进来。
  assert.equal(
    branchEvidence("福永店", "先记烧鹅王(立新湖酒楼)", "深圳市宝安区福永街道办凤塘大道1号", "先记烧鹅王福永店"),
    "mismatch",
  );
});

test("branchMatches 是 branchEvidence 的布尔包装：只有 mismatch 算「不是这家」", () => {
  assert.equal(branchMatches("", "任意店", "任意地址", ""), true);
  assert.equal(branchMatches("深圳总店", "牛百鲜·牛腩煲火锅(古城店)", "", ""), false);
});

// ── 高德字段的脏数据 ────────────────────────────────────────────────────────

test("asText：高德缺地址时给的是空数组，不是空串", () => {
  // 实测来源：点评 29 号「电白鸭粥店(宝民二路店)」这条 POI 的 address 就是 []。
  // 不拦这一下，collectHits 里那句无条件的地址佐证会直接抛 TypeError（500）。
  assert.equal(asText([]), "");
  assert.equal(asText(undefined), "");
  assert.equal(asText(null), "");
  assert.equal(asText(0), "");
  assert.equal(asText("创业路1777号"), "创业路1777号");
});

test("asText 兜底：判据函数收到非字符串也不抛，只是判不中", () => {
  assert.equal(plainText([]), "");
  assert.equal(coreName({}), "");
  assert.equal(addressCorroborated("创业路1777号海信南方大厦", []), false);
  assert.equal(addressCorroborated("创业路1777号海信南方大厦", undefined), false);
  assert.equal(branchEvidence("", [], [], ""), "absent");
});

// ── coreName 归一化 ─────────────────────────────────────────────────────────

test("coreName：弯引号、直角引号、间隔号都算标点，要剥掉", () => {
  // 点评/美团的分享文案里几乎都是 ’（U+2019）。不剥它，「Emily’s Cafe」和「Emily's Cafe」
  // 会变成两个不同字符串，匹配强度白白从 strong 掉到 weak（实测撞上过这条）。
  assert.equal(coreName("Emily’s Cafe"), coreName("Emily's Cafe"));
  assert.equal(coreName("巴扎美食·新疆菜"), "巴扎美食新疆菜");
  assert.equal(coreName("先记烧鹅王·本地粤菜(福永店)"), "先记烧鹅王本地粤菜");
});
