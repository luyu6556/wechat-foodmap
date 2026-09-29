import { env } from "cloudflare:workers";
import { clean, db, fail, hashToken, memberFromRequest, parseJson, serverError } from "../../../../lib/server";

export async function POST(request: Request) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    if (!env.OWNER_CLAIM_CODE_HASH) return fail("群主管理口令尚未配置", 503);
    const body = await parseJson(request);
    const code = clean(body.code, 100);
    if (!code || await hashToken(code) !== env.OWNER_CLAIM_CODE_HASH) return fail("群主口令不正确", 403);
    const result = await db().prepare(`UPDATE members SET is_owner = 1 WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM members WHERE is_owner = 1)`).bind(member.id).run();
    if (!result.meta.changes) return fail("群主身份已被领取", 409);
    return Response.json({ member: { ...member, isOwner: 1 } });
  } catch (error) { return serverError(error); }
}
