import test from "node:test";
import assert from "node:assert/strict";
import { buildPollResultText } from "../lib/poll-text.ts";

function detail() {
  return {
    poll: { id: "poll", title: "周末去哪吃", status: "closed", createdAt: 1,
      createdBy: "a", creatorName: "阿甲", creatorColor: "#000000",
      closedAt: 2, closedBy: "b", closedByName: "阿乙" },
    options: [
      { placeId: "a", name: "第一家", address: "地址甲", cuisine: "粤菜", avgPrice: 88,
        platformRating: 4.5, averageRating: 4, deleted: false, count: 1,
        votes: [{ placeId: "a", memberId: "a", memberName: "阿甲", memberColor: "#000000", note: "想吃烧鹅", createdAt: 1, mine: true }] },
      { placeId: "b", name: "第二家", address: "地址乙", cuisine: "火锅", avgPrice: 120,
        platformRating: null, averageRating: null, deleted: false, count: 2,
        votes: [{ placeId: "b", memberId: "b", memberName: "阿乙", memberColor: "#000000", note: "", createdAt: 1, mine: false },
          { placeId: "b", memberId: "c", memberName: "阿丙", memberColor: "#000000", note: "适合聚餐", createdAt: 1, mine: false }] },
    ],
    my: { placeId: "a", note: "想吃烧鹅" }, totalMembers: 4,
    notVoted: [{ id: "d", name: "阿丁", color: "#000000" }],
  };
}

test("复制文本按票数排列，人数、人名和理由与详情一致", () => {
  const result = buildPollResultText(detail());
  assert.match(result, /已投 3\/4 人/);
  assert.ok(result.indexOf("第二家 · 2 票") < result.indexOf("第一家 · 1 票"));
  assert.match(result, /阿甲：想吃烧鹅/);
  assert.match(result, /阿丙：适合聚餐/);
  assert.match(result, /未投：阿丁/);
  assert.match(result, /就这家：第二家/);
});

test("最高票并列时明确写平票，不擅自选赢家", () => {
  const data = detail();
  data.options[0].count = 2;
  data.options[0].votes.push({ ...data.options[0].votes[0], memberId: "d", memberName: "阿丁", note: "" });
  data.notVoted = [];
  const result = buildPollResultText(data);
  assert.match(result, /平票，需要再商量/);
  assert.doesNotMatch(result, /就这家/);
  assert.match(result, /未投：无/);
});

test("无人投票时不把零票并列误报为平票", () => {
  const data = detail();
  data.options.forEach((option) => { option.count = 0; option.votes = []; });
  const result = buildPollResultText(data);
  assert.match(result, /还没有人投票/);
  assert.doesNotMatch(result, /平票/);
});

test("地点删除后保留店名、人均和删除标记", () => {
  const data = detail();
  data.options[0].deleted = true;
  const result = buildPollResultText(data);
  assert.match(result, /第一家 · 1 票 · 人均 ¥88 · 已从地图删除/);
});
