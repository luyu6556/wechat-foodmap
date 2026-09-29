import { db, fail, memberFromRequest, serverError } from "../../../../lib/server";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const database = db();
    const place = await database.prepare(`
      SELECT p.id, p.name, p.address, p.category, p.lat, p.lng,
        p.source_text AS sourceText, p.source_url AS sourceUrl, p.source_platform AS sourcePlatform,
        p.created_at AS createdAt, m.name AS creatorName, m.color AS creatorColor,
        (SELECT COUNT(*) FROM likes l WHERE l.place_id = p.id) AS likesCount,
        (SELECT COUNT(*) FROM visits v WHERE v.place_id = p.id) AS visitsCount,
        (SELECT ROUND(AVG(r.score), 1) FROM ratings r WHERE r.place_id = p.id) AS averageRating,
        (SELECT COUNT(*) FROM ratings r WHERE r.place_id = p.id) AS ratingsCount
      FROM places p JOIN members m ON m.id = p.created_by WHERE p.id = ?
    `).bind(id).first();
    if (!place) return fail("地点不存在", 404);
    const [comments, photos, visitors] = await Promise.all([
      database.prepare(`SELECT c.id, c.body, c.created_at AS createdAt,
        m.name AS memberName, m.color AS memberColor FROM comments c
        JOIN members m ON m.id = c.member_id WHERE c.place_id = ? ORDER BY c.created_at DESC LIMIT 100`).bind(id).all(),
      database.prepare(`SELECT ph.id, ph.created_at AS createdAt,
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
    return Response.json({ place, comments: comments.results, photos: photos.results, visitors: visitors.results, my: state });
  } catch (error) {
    return serverError(error);
  }
}
