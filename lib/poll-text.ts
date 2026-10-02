import type { PollDetail } from "../components/types";

export function buildPollResultText(detail: PollDetail) {
  const { poll, options, totalMembers, notVoted } = detail;
  const voted = options.reduce((sum, option) => sum + option.count, 0);
  const ordered = options.map((option, index) => ({ option, index }))
    .sort((a, b) => b.option.count - a.option.count || a.index - b.index);
  const maximum = ordered[0]?.option.count || 0;
  const leaders = maximum ? ordered.filter(({ option }) => option.count === maximum) : [];
  const lines = [`【${poll.title}】`, `已投 ${voted}/${totalMembers} 人`];
  if (poll.status === "closed") {
    lines.push(`结束：${poll.closedByName || "群友"} · ${new Date(poll.closedAt || poll.createdAt).toLocaleString("zh-CN")}`);
  }
  if (!maximum) lines.push("还没有人投票");
  else if (leaders.length > 1) lines.push("平票，需要再商量");
  else if (poll.status === "closed") lines.push(`就这家：${leaders[0].option.name}`);
  lines.push("");
  ordered.forEach(({ option }, index) => {
    const metadata = [option.avgPrice == null ? "人均待补充" : `人均 ¥${option.avgPrice}`];
    if (option.deleted) metadata.push("已从地图删除");
    lines.push(`${index + 1}. ${option.name} · ${option.count} 票 · ${metadata.join(" · ")}`);
    for (const vote of option.votes) lines.push(`   ${vote.memberName}${vote.note ? `：${vote.note}` : ""}`);
  });
  lines.push("", `未投：${notVoted.length ? notVoted.map((member) => member.name).join("、") : "无"}`);
  return lines.join("\n");
}
