import { db, fail, memberFromRequest, parseJson, serverError } from "../../../../../lib/server";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    const body = await parseJson(request).catch(() => null);
    if (!body || !(body.placeId === null || (typeof body.placeId === "string" && body.placeId.trim()))) {
      return fail("请选择候选地点，或撤回投票");
    }
    const placeId = typeof body.placeId === "string" ? body.placeId.trim() : null;
    const note = body.note === undefined ? "" : typeof body.note === "string" ? body.note.trim() : null;
    if (note === null || Array.from(note).length > 140) return fail("推荐理由不能超过 140 字");
    const { id } = await context.params;
    const database = db();
    const poll = await database.prepare("SELECT status FROM polls WHERE id = ?").bind(id).first<{ status: string }>();
    if (!poll) return fail("投票不存在", 404);
    if (poll.status !== "open") return fail("投票已经结束了", 409);

    if (placeId === null) {
      const result = await database.prepare(`DELETE FROM poll_votes WHERE poll_id = ? AND member_id = ?
        AND EXISTS (SELECT 1 FROM polls WHERE id = ? AND status = 'open')`)
        .bind(id, member.id, id).run();
      if (!result.meta.changes) {
        const stillOpen = await database.prepare("SELECT status FROM polls WHERE id = ?").bind(id).first<{ status: string }>();
        if (stillOpen?.status !== "open") return fail("投票已经结束了", 409);
      }
      return Response.json({ ok: true, placeId: null });
    }

    const now = Date.now();
    const result = await database.prepare(`INSERT INTO poll_votes
      (poll_id, place_id, member_id, note, created_at, updated_at)
      SELECT p.id, o.place_id, ?, ?, ?, ? FROM polls p
      JOIN poll_options o ON o.poll_id = p.id
      WHERE p.id = ? AND p.status = 'open' AND o.place_id = ?
      ON CONFLICT(poll_id, member_id) DO UPDATE SET
        place_id = excluded.place_id, note = excluded.note, updated_at = excluded.updated_at
      WHERE EXISTS (SELECT 1 FROM polls WHERE id = excluded.poll_id AND status = 'open')`)
      .bind(member.id, note, now, now, id, placeId).run();
    if (!result.meta.changes) {
      const current = await database.prepare("SELECT status FROM polls WHERE id = ?").bind(id).first<{ status: string }>();
      return current?.status === "open" ? fail("这家店不在本次投票的候选中") : fail("投票已经结束了", 409);
    }
    return Response.json({ ok: true, placeId });
  } catch (error) {
    return serverError(error);
  }
}
