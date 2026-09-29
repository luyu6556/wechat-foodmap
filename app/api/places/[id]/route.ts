import { bucket, canManage, clean, db, fail, memberFromRequest, parseJson, serverError } from "../../../../lib/server";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const database = db();
    const place = await database.prepare(`
      SELECT p.id, p.name, p.address, p.category, p.lat, p.lng,
        p.source_text AS sourceText, p.source_url AS sourceUrl, p.source_platform AS sourcePlatform,
        p.created_at AS createdAt, p.created_by AS creatorId, m.name AS creatorName, m.color AS creatorColor,
        (SELECT COUNT(*) FROM likes l WHERE l.place_id = p.id) AS likesCount,
        (SELECT COUNT(*) FROM visits v WHERE v.place_id = p.id) AS visitsCount,
        (SELECT ROUND(AVG(r.score), 1) FROM ratings r WHERE r.place_id = p.id) AS averageRating,
        (SELECT COUNT(*) FROM ratings r WHERE r.place_id = p.id) AS ratingsCount
      FROM places p JOIN members m ON m.id = p.created_by WHERE p.id = ?
    `).bind(id).first();
    if (!place) return fail("地点不存在", 404);
    const [comments, photos, visitors] = await Promise.all([
      database.prepare(`SELECT c.id, c.body, c.member_id AS memberId, c.created_at AS createdAt,
        m.name AS memberName, m.color AS memberColor FROM comments c
        JOIN members m ON m.id = c.member_id WHERE c.place_id = ? ORDER BY c.created_at DESC LIMIT 100`).bind(id).all(),
      database.prepare(`SELECT ph.id, ph.member_id AS memberId, ph.created_at AS createdAt,
        m.name AS memberName, m.color AS memberColor FROM photos ph
        JOIN members m ON m.id = ph.member_id WHERE ph.place_id = ? ORDER BY ph.created_at DESC LIMIT 100`).bind(id).all(),
      database.prepare(`SELECT m.id, m.name, m.color FROM visits v
        JOIN members m ON m.id = v.member_id WHERE v.place_id = ? ORDER BY v.created_at DESC LIMIT 100`).bind(id).all(),
    ]);
    const member = await memberFromRequest(request);
    const state = member ? await database.prepare(`
      SELECT (SELECT COUNT(*) FROM likes WHERE place_id = ? AND member_id = ?) AS liked,
        (SELECT COUNT(*) FROM visits WHERE place_id = ? AND member_id = ?) AS visited,
        (SELECT score FROM ratings WHERE place_id = ? AND member_id = ?) AS rating
    `).bind(id, member.id, id, member.id, id, member.id).first() : null;
    const creatorId = (place as { creatorId: string }).creatorId;
    const withPermission = (rows: Record<string, unknown>[]) => rows.map(({ memberId, ...row }) => ({
      ...row, canManage: canManage(member, String(memberId)),
    }));
    return Response.json({ place, comments: withPermission(comments.results as Record<string, unknown>[]),
      photos: withPermission(photos.results as Record<string, unknown>[]), visitors: visitors.results,
      my: state, canManagePlace: canManage(member, creatorId) });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    const { id } = await context.params;
    const database = db();
    const place = await database.prepare("SELECT created_by AS creatorId FROM places WHERE id = ?")
      .bind(id).first<{ creatorId: string }>();
    if (!place) return fail("地点不存在", 404);
    if (!canManage(member, place.creatorId)) return fail("没有修改权限", 403);
    const body = await parseJson(request);
    const name = clean(body.name, 80);
    const address = clean(body.address, 200);
    const category = body.category === "玩乐" ? "玩乐" : "美食";
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!name) return fail("请填写地点名称");
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return fail("请在地图上选择地点位置");
    await database.prepare("UPDATE places SET name = ?, address = ?, category = ?, lat = ?, lng = ?, updated_at = ? WHERE id = ?")
      .bind(name, address, category, lat, lng, Date.now(), id).run();
    return Response.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    const { id } = await context.params;
    const database = db();
    const place = await database.prepare("SELECT created_by AS creatorId FROM places WHERE id = ?")
      .bind(id).first<{ creatorId: string }>();
    if (!place) return fail("地点不存在", 404);
    if (!canManage(member, place.creatorId)) return fail("没有删除权限", 403);
    const photos = await database.prepare("SELECT object_key AS objectKey FROM photos WHERE place_id = ?")
      .bind(id).all<{ objectKey: string }>();
    await database.batch([
      database.prepare("DELETE FROM likes WHERE place_id = ?").bind(id),
      database.prepare("DELETE FROM visits WHERE place_id = ?").bind(id),
      database.prepare("DELETE FROM ratings WHERE place_id = ?").bind(id),
      database.prepare("DELETE FROM comments WHERE place_id = ?").bind(id),
      database.prepare("DELETE FROM photos WHERE place_id = ?").bind(id),
      database.prepare("DELETE FROM places WHERE id = ?").bind(id),
    ]);
    const keys = (photos.results || []).map((item) => item.objectKey);
    if (keys.length) await bucket().delete(keys).catch((error) => console.error("Failed to remove deleted place photos", error));
    return Response.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
