import { clean, db, fail, memberFromRequest, parseJson, serverError } from "../../../lib/server";

type FeedbackRow = {
  id: string; memberId: string | null; memberName: string; memberColor: string;
  body: string; createdAt: number;
};

// 提交对所有人开放（设了昵称就能提）；读取只给群主。
// 昵称和颜色在写入时存成快照，之后改昵称、改颜色都不会改写历史反馈。
export async function POST(request: Request) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    const body = await parseJson(request).catch(() => null);
    const text = clean(body?.body, 500);
    if (!text) return fail("先写点什么再提交吧");
    const id = crypto.randomUUID();
    await db().prepare(`INSERT INTO feedback (id, member_id, member_name, member_color, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, member.id, member.name, member.color, text, Date.now()).run();
    return Response.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

export async function GET(request: Request) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    if (!member.isOwner) return fail("只有群主能查看反馈", 403);
    const rows = await db().prepare(`SELECT id, member_id AS memberId, member_name AS memberName,
      member_color AS memberColor, body, created_at AS createdAt
      FROM feedback ORDER BY created_at DESC, id DESC LIMIT 200`).all<FeedbackRow>();
    return Response.json({ items: rows.results || [] });
  } catch (error) {
    return serverError(error);
  }
}
