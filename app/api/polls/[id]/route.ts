import { db, fail, memberFromRequest, parseJson, serverError } from "../../../../lib/server";

type Context = { params: Promise<{ id: string }> };
type PollRow = {
  id: string; title: string; status: "open" | "closed"; createdAt: number;
  createdBy: string; creatorName: string; creatorColor: string;
  closedAt: number | null; closedBy: string | null; closedByName: string | null;
};
type OptionRow = {
  placeId: string; name: string; address: string; cuisine: string;
  avgPrice: number | null; platformRating: number | null; averageRating: number | null;
  deleted: number; sortOrder: number;
};
type VoteRow = {
  placeId: string; memberId: string; memberName: string; memberColor: string;
  note: string; createdAt: number;
};
type MemberRow = { id: string; name: string; color: string };

export async function GET(request: Request, context: Context) {
  try {
    const member = await memberFromRequest(request);
    const { id } = await context.params;
    const database = db();
    const [pollResult, optionResult, voteResult, memberResult] = await database.batch([
      database.prepare(`SELECT p.id, p.title, p.status, p.created_by AS createdBy,
        p.created_at AS createdAt, p.closed_by AS closedBy, p.closed_at AS closedAt,
        creator.name AS creatorName, creator.color AS creatorColor, closer.name AS closedByName
        FROM polls p JOIN members creator ON creator.id = p.created_by
        LEFT JOIN members closer ON closer.id = p.closed_by WHERE p.id = ?`).bind(id),
      database.prepare(`SELECT o.place_id AS placeId,
        CASE WHEN pl.id IS NULL THEN o.place_name ELSE pl.name END AS name,
        CASE WHEN pl.id IS NULL THEN o.place_address ELSE pl.address END AS address,
        CASE WHEN pl.id IS NULL THEN o.place_cuisine ELSE pl.cuisine END AS cuisine,
        CASE WHEN pl.id IS NULL THEN o.place_avg_price ELSE pl.avg_price END AS avgPrice,
        CASE WHEN pl.id IS NULL THEN o.place_platform_rating ELSE pl.platform_rating END AS platformRating,
        CASE WHEN pl.id IS NULL THEN o.place_average_rating
          ELSE (SELECT ROUND(AVG(r.score), 1) FROM ratings r WHERE r.place_id = pl.id) END AS averageRating,
        (pl.id IS NULL) AS deleted, o.sort_order AS sortOrder
        FROM poll_options o LEFT JOIN places pl ON pl.id = o.place_id
        WHERE o.poll_id = ? ORDER BY o.sort_order, o.place_id`).bind(id),
      database.prepare(`SELECT v.place_id AS placeId, v.member_id AS memberId,
        m.name AS memberName, m.color AS memberColor, v.note, v.created_at AS createdAt
        FROM poll_votes v JOIN members m ON m.id = v.member_id
        WHERE v.poll_id = ? ORDER BY v.created_at, v.member_id`).bind(id),
      database.prepare(`SELECT m.id, m.name, m.color FROM members m
        JOIN polls p ON p.id = ?
        WHERE p.status = 'open' OR m.created_at <= p.closed_at
        ORDER BY m.created_at, m.id`).bind(id),
    ]);
    const poll = (pollResult.results || [])[0] as PollRow | undefined;
    if (!poll) return fail("投票不存在", 404);
    const rows = (optionResult.results || []) as OptionRow[];
    const votes = (voteResult.results || []) as VoteRow[];
    const members = (memberResult.results || []) as MemberRow[];
    const byOption = new Map<string, VoteRow[]>();
    for (const vote of votes) byOption.set(vote.placeId, [...(byOption.get(vote.placeId) || []), vote]);
    const options = rows.map((row) => {
      const optionVotes = (byOption.get(row.placeId) || []).map((vote) => ({
        ...vote, mine: vote.memberId === member?.id,
      }));
      return { placeId: row.placeId, name: row.name, address: row.address, cuisine: row.cuisine,
        avgPrice: row.avgPrice, platformRating: row.platformRating, averageRating: row.averageRating,
        deleted: !!row.deleted, count: optionVotes.length, votes: optionVotes };
    });
    const myVote = member ? votes.find((vote) => vote.memberId === member.id) : null;
    const votedIds = new Set(votes.map((vote) => vote.memberId));
    return Response.json({
      poll,
      options,
      my: myVote ? { placeId: myVote.placeId, note: myVote.note } : null,
      totalMembers: members.length,
      notVoted: members.filter((person) => !votedIds.has(person.id)),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    const body = await parseJson(request).catch(() => null);
    if (body?.status !== "closed") return fail("只支持结束投票");
    const { id } = await context.params;
    const database = db();
    const closedAt = Date.now();
    const result = await database.prepare(`UPDATE polls SET status = 'closed', closed_by = ?, closed_at = ?
      WHERE id = ? AND status = 'open'`).bind(member.id, closedAt, id).run();
    if (!result.meta.changes) {
      const existing = await database.prepare("SELECT status FROM polls WHERE id = ?").bind(id).first();
      return existing ? fail("投票已经结束了", 409) : fail("投票不存在", 404);
    }
    return Response.json({ ok: true, closedAt, closedBy: member.id });
  } catch (error) {
    return serverError(error);
  }
}
