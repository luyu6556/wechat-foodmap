import { db, fail, serverError } from "../../../../lib/server";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = (params.get("q") || "").trim();
    if (Array.from(query).length > 60) return fail("搜索词不能超过 60 字");
    const cursor = params.get("cursor");
    const parts = cursor ? /^(\d{1,13})\.([0-9a-f-]{36})$/i.exec(cursor) : null;
    if (cursor && !parts) return fail("无效的候选游标");
    const conditions = [];
    const values: (string | number)[] = [];
    if (query) {
      conditions.push("(p.name LIKE ? OR p.address LIKE ?)");
      values.push(`%${query}%`, `%${query}%`);
    }
    if (parts) {
      conditions.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
      values.push(Number(parts[1]), Number(parts[1]), parts[2]);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await db().prepare(`SELECT p.id, p.name, p.address, p.cuisine,
      p.avg_price AS avgPrice, p.platform_rating AS platformRating,
      (SELECT ROUND(AVG(r.score), 1) FROM ratings r WHERE r.place_id = p.id) AS averageRating,
      p.created_at AS createdAt FROM places p ${where}
      ORDER BY p.created_at DESC, p.id DESC LIMIT 31`).bind(...values).all<{
        id: string; name: string; address: string; cuisine: string; avgPrice: number | null;
        platformRating: number | null; averageRating: number | null; createdAt: number;
      }>();
    const rows = result.results || [];
    const hasMore = rows.length > 30;
    const page = rows.slice(0, 30);
    const last = page.at(-1);
    return Response.json({
      places: page.map((place) => ({ id: place.id, name: place.name, address: place.address,
        cuisine: place.cuisine, avgPrice: place.avgPrice, platformRating: place.platformRating,
        averageRating: place.averageRating })),
      nextCursor: hasMore && last ? `${last.createdAt}.${last.id}` : null,
    });
  } catch (error) {
    return serverError(error);
  }
}
