import test from "node:test";
import assert from "node:assert/strict";
import { gcjToWgs, resolveSharedText, wgsToGcj } from "../lib/resolve.ts";

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

test("点评短链分享文案：店名取【】首段，地址取【地址：】分段，电话不污染店名", () => {
  // 2026-10-01 用户提供的真实样例（dpurl.cn 短链，URL 参数里没有任何字段）
  const result = resolveSharedText(
    "【杨箕小馆·地道广州菜（番禺万博店）】快来试试这家餐厅吧！ 【地址：番禺区汉溪大道东386号晟潮C-WAVE-4层403】【电话：18928846589】@美团 http://dpurl.cn/C3BkQc4z",
  );
  assert.equal(result.name, "杨箕小馆·地道广州菜（番禺万博店）");
  assert.equal(result.address, "番禺区汉溪大道东386号晟潮C-WAVE-4层403");
  assert.equal(result.sourcePlatform, "大众点评");
  assert.equal(result.sourceUrl, "http://dpurl.cn/C3BkQc4z");
  assert.equal(result.lat, null);
  assert.match(result.message, /选点/);
});

test("链接参数里的地址优先于文案分段", () => {
  const result = resolveSharedText(
    "【某店】宣传语 【地址：文案里的地址】 https://maps.apple.com/?name=某店&address=链接里的地址&coordinate=22.5,114.0",
  );
  assert.equal(result.name, "某店");
  assert.equal(result.address, "链接里的地址");
});
