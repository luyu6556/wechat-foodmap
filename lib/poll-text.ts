import type { PollDetail } from "../components/types";

/**
 * 复制到群里的投票结果。
 *
 * 编号规则：**按选项在投票里的固定顺序**（＝投票页面列表顺序＝地图图钉上的数字），
 * 刻意不按票数重排 —— 否则群消息里的「1 号」和地图上的 1 号对不上。
 * 谁是最高票由开头那句「就这家」交代。
 *
 * 每项只写「编号、店名、票数」，不写人均、不写投票理由：
 * 群里看结果只需要知道谁赢了、各多少票，细节回页面看。
 */
export function buildPollResultText(detail: PollDetail) {
  const { poll, options, totalMembers, notVoted } = detail;
  const voted = options.reduce((sum, option) => sum + option.count, 0);
  const maximum = options.reduce((most, option) => Math.max(most, option.count), 0);
  const leaders = maximum ? options.filter((option) => option.count === maximum) : [];
  const lines = [`【${poll.title}】`, `已投 ${voted}/${totalMembers} 人`];
  if (poll.status === "closed") {
    lines.push(`结束：${poll.closedByName || "群友"} · ${new Date(poll.closedAt || poll.createdAt).toLocaleString("zh-CN")}`);
  }
  if (!maximum) lines.push("还没有人投票");
  else if (leaders.length > 1) lines.push("平票，需要再商量");
  else if (poll.status === "closed") lines.push(`就这家：${leaders[0].name}`);
  lines.push("");
  options.forEach((option, index) => {
    lines.push(`${index + 1}. ${option.name} · ${option.count} 票${option.deleted ? " · 已从地图删除" : ""}`);
  });
  lines.push("", `未投：${notVoted.length ? notVoted.map((member) => member.name).join("、") : "无"}`);
  return lines.join("\n");
}
