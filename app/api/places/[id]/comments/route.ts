import { clean, db, fail, memberFromRequest, parseJson, serverError } from "../../../../../lib/server";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    const { id } = await context.params;
    const body = await parseJson(request);
    const text = clean(body.body, 500);
    if (!text) return fail("请输入评论");
    const database = db();
    if (!await database.prepare("SELECT id FROM places WHERE id = ?").bind(id).first()) return fail("地点不存在", 404);
    await database.prepare("INSERT INTO comments (id, place_id, member_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, member.id, text, Date.now()).run();
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
