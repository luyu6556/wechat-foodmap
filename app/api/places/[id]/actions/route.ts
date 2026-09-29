import { db, fail, memberFromRequest, parseJson, serverError } from "../../../../../lib/server";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    const { id } = await context.params;
    const body = await parseJson(request);
    const database = db();
    const place = await database.prepare("SELECT id FROM places WHERE id = ?").bind(id).first();
    if (!place) return fail("地点不存在", 404);
    if (body.action === "rating") {
      const score = Number(body.score);
      if (!Number.isInteger(score) || score < 1 || score > 5) return fail("评分须为 1 到 5 星");
      await database.prepare(`INSERT INTO ratings (place_id, member_id, score, created_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(place_id, member_id) DO UPDATE SET score = excluded.score, created_at = excluded.created_at`)
        .bind(id, member.id, score, Date.now()).run();
      return Response.json({ ok: true });
    }
    if (body.action === "like" || body.action === "visit") {
      const table = body.action === "like" ? "likes" : "visits";
      const existing = await database.prepare(`SELECT 1 FROM ${table} WHERE place_id = ? AND member_id = ?`)
        .bind(id, member.id).first();
      if (existing) {
        await database.prepare(`DELETE FROM ${table} WHERE place_id = ? AND member_id = ?`).bind(id, member.id).run();
      } else {
        await database.prepare(`INSERT INTO ${table} (place_id, member_id, created_at) VALUES (?, ?, ?)`)
          .bind(id, member.id, Date.now()).run();
      }
      return Response.json({ active: !existing });
    }
    return fail("未知操作");
  } catch (error) {
    return serverError(error);
  }
}
