import { db, fail, memberFromRequest, parseJson, serverError } from "../../../lib/server";

type SummaryRow = {
  id: string; title: string; status: "open" | "closed"; createdAt: number;
  closedAt: number | null; closedByName: string | null;
  creatorName: string; creatorColor: string;
  totalVotes: number; optionCount: number; totalMembers: number;
};
type TopRow = { pollId: string; placeId: string; name: string; count: number };
type PlaceRow = {
  id: string; name: string; address: string; cuisine: string;
  avgPrice: number | null; platformRating: number | null; averageRating: number | null;
};

const summarySql = `SELECT p.id, p.title, p.status, p.created_at AS createdAt,
  p.closed_at AS closedAt, closer.name AS closedByName,
  creator.name AS creatorName, creator.color AS creatorColor,
  (SELECT COUNT(*) FROM poll_votes v WHERE v.poll_id = p.id) AS totalVotes,
  (SELECT COUNT(*) FROM poll_options o WHERE o.poll_id = p.id) AS optionCount,
  (SELECT COUNT(*) FROM members m WHERE p.closed_at IS NULL OR m.created_at <= p.closed_at) AS totalMembers
  FROM polls p JOIN members creator ON creator.id = p.created_by
  LEFT JOIN members closer ON closer.id = p.closed_by`;

function isSingleOpenConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed: polls\.status|polls_single_open/i.test(message);
}

export async function GET(request: Request) {
  try {
    // Reading is public, like the existing place list. Identity is still resolved
    // through the existing token/cookie model rather than introducing another one.
    await memberFromRequest(request);
    const cursor = new URL(request.url).searchParams.get("cursor");
    const parts = cursor ? /^(\d{1,13})\.([0-9a-f-]{36})$/i.exec(cursor) : null;
    if (cursor && !parts) return fail("无效的历史游标");
    const database = db();
    const historyQuery = `${summarySql} WHERE p.status = 'closed'${parts ? " AND (p.closed_at < ? OR (p.closed_at = ? AND p.id < ?))" : ""}
      ORDER BY p.closed_at DESC, p.id DESC LIMIT 21`;
    const historyStatement = database.prepare(historyQuery);
    const [openResult, historyResult] = await database.batch([
      database.prepare(`${summarySql} WHERE p.status = 'open' LIMIT 1`),
      parts ? historyStatement.bind(Number(parts[1]), Number(parts[1]), parts[2]) : historyStatement,
    ]);
    const open = (openResult.results || [])[0] as SummaryRow | undefined;
    const historyRows = (historyResult.results || []) as SummaryRow[];
    const hasMore = historyRows.length > 20;
    const page = historyRows.slice(0, 20);
    const ids = [...(open ? [open.id] : []), ...page.map((row) => row.id)];
    const leaders = new Map<string, { placeId: string; name: string; count: number }[]>();
    if (ids.length) {
      const marks = ids.map(() => "?").join(",");
      const result = await database.prepare(`SELECT o.poll_id AS pollId, o.place_id AS placeId,
        COALESCE(pl.name, o.place_name) AS name, COUNT(v.member_id) AS count
        FROM poll_options o LEFT JOIN places pl ON pl.id = o.place_id
        LEFT JOIN poll_votes v ON v.poll_id = o.poll_id AND v.place_id = o.place_id
        WHERE o.poll_id IN (${marks}) GROUP BY o.poll_id, o.place_id`).bind(...ids).all<TopRow>();
      const grouped = new Map<string, TopRow[]>();
      for (const row of result.results || []) grouped.set(row.pollId, [...(grouped.get(row.pollId) || []), row]);
      for (const [id, rows] of grouped) {
        const maximum = Math.max(0, ...rows.map((row) => row.count));
        leaders.set(id, maximum ? rows.filter((row) => row.count === maximum)
          .map(({ placeId, name, count }) => ({ placeId, name, count })) : []);
      }
    }
    const withLeaders = (row: SummaryRow) => ({ ...row, topOptions: leaders.get(row.id) || [] });
    const last = page.at(-1);
    return Response.json({
      open: open ? withLeaders(open) : null,
      history: page.map(withLeaders),
      nextCursor: hasMore && last ? `${last.closedAt}.${last.id}` : null,
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    const body = await parseJson(request).catch(() => null);
    if (!body) return fail("无效输入");
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || Array.from(title).length > 30) return fail("投票标题需要填写，且不超过 30 字");
    if (!Array.isArray(body.placeIds) || body.placeIds.some((id) => typeof id !== "string" || !id.trim())) {
      return fail("请选择已有地点作为候选");
    }
    const placeIds = [...new Set((body.placeIds as string[]).map((id) => id.trim()))];
    if (placeIds.length < 2 || placeIds.length > 8) return fail("候选需要 2 到 8 家");
    const note = body.note === undefined ? "" : typeof body.note === "string" ? body.note.trim() : null;
    if (note === null || Array.from(note).length > 500) return fail("投票说明不能超过 500 字");

    const database = db();
    const marks = placeIds.map(() => "?").join(",");
    const found = await database.prepare(`SELECT p.id, p.name, p.address, p.cuisine,
      p.avg_price AS avgPrice, p.platform_rating AS platformRating,
      (SELECT ROUND(AVG(r.score), 1) FROM ratings r WHERE r.place_id = p.id) AS averageRating
      FROM places p WHERE p.id IN (${marks})`).bind(...placeIds).all<PlaceRow>();
    const byId = new Map((found.results || []).map((place) => [place.id, place]));
    if (byId.size !== placeIds.length) return fail("候选中有不存在的地点");

    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await database.batch([
        database.prepare(`INSERT INTO polls (id, title, note, status, created_by, created_at)
          VALUES (?, ?, ?, 'open', ?, ?)`).bind(id, title, note, member.id, now),
        ...placeIds.map((placeId, sortOrder) => {
          const place = byId.get(placeId)!;
          return database.prepare(`INSERT INTO poll_options
            (poll_id, place_id, place_name, place_address, place_cuisine,
              place_avg_price, place_platform_rating, place_average_rating, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(id, placeId, place.name, place.address, place.cuisine,
              place.avgPrice, place.platformRating, place.averageRating, sortOrder);
        }),
      ]);
    } catch (error) {
      if (isSingleOpenConflict(error)) return fail("已有进行中的投票，请先结束它", 409);
      throw error;
    }
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
