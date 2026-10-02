import { clean, db, fail, memberFromRequest, optionalNumber, parseJson, serverError } from "../../../lib/server";

export async function GET() {
  try {
    const rows = await db().prepare(`
      SELECT p.id, p.name, p.address, p.category, p.lat, p.lng, p.source_platform AS sourcePlatform,
        p.cuisine, p.platform_rating AS platformRating, p.rating_count AS ratingCount, p.avg_price AS avgPrice,
        p.recommendation,
        p.created_at AS createdAt, p.created_by AS creatorId, m.name AS creatorName, m.color AS creatorColor,
        (SELECT COUNT(*) FROM likes l WHERE l.place_id = p.id) AS likesCount,
        (SELECT COUNT(*) FROM visits v WHERE v.place_id = p.id) AS visitsCount,
        (SELECT ROUND(AVG(r.score), 1) FROM ratings r WHERE r.place_id = p.id) AS averageRating,
        (SELECT COUNT(*) FROM ratings r WHERE r.place_id = p.id) AS ratingsCount,
        (SELECT id FROM photos ph WHERE ph.place_id = p.id ORDER BY ph.created_at DESC LIMIT 1) AS coverPhotoId
      FROM places p JOIN members m ON m.id = p.created_by ORDER BY p.created_at DESC LIMIT 500
    `).all();
    return Response.json({ places: rows.results });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    const body = await parseJson(request);
    const name = clean(body.name, 80);
    const address = clean(body.address, 200);
    // 添加者自己写的推荐理由，选填。识别产不出它，所以这里只接受人手输入。
    const recommendation = clean(body.recommendation, 150);
    const category = body.category === "玩乐" ? "玩乐" : "美食";
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const sourceText = clean(body.sourceText, 3000);
    const sourcePlatform = clean(body.sourcePlatform, 30) || "手动输入";
    const cuisine = clean(body.cuisine, 20);
    const sourceRaw = clean(body.sourceRaw, 600);
    const platformRating = optionalNumber(body.platformRating, 0, 5, false);
    const ratingCount = optionalNumber(body.ratingCount, 0, 10_000_000, true);
    const avgPrice = optionalNumber(body.avgPrice, 0, 100_000, true);
    let sourceUrl = clean(body.sourceUrl, 2000) || null;
    if (sourceUrl) {
      try {
        const parsed = new URL(sourceUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) sourceUrl = null;
      } catch { sourceUrl = null; }
    }
    if (!name) return fail("请填写地点名称");
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return fail("还没定位到，请用「用当前位置」或手动输入坐标");
    }
    const database = db();
    const duplicate = sourceUrl
      ? await database.prepare("SELECT id FROM places WHERE source_url = ? LIMIT 1").bind(sourceUrl).first<{ id: string }>()
      : await database.prepare("SELECT id FROM places WHERE name = ? AND ABS(lat - ?) < 0.0002 AND ABS(lng - ?) < 0.0002 LIMIT 1")
        .bind(name, lat, lng).first<{ id: string }>();
    if (duplicate) return Response.json({ error: "这个地点已收录", existingId: duplicate.id }, { status: 409 });
    const id = crypto.randomUUID();
    const now = Date.now();
    await database.prepare(`INSERT INTO places
      (id, name, address, recommendation, category, lat, lng, source_text, source_url, source_platform,
        cuisine, platform_rating, rating_count, avg_price, source_raw, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, name, address, recommendation, category, lat, lng, sourceText, sourceUrl, sourcePlatform,
        cuisine, platformRating, ratingCount, avgPrice, sourceRaw, member.id, now, now).run();
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
