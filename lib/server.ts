import { env } from "cloudflare:workers";

export type Member = { id: string; name: string; color: string; isOwner: number; wechatLinked: number };

export function db(): D1Database {
  if (!env.DB) throw new Error("数据库暂不可用，请稍后重试");
  return env.DB;
}

export function bucket(): R2Bucket {
  if (!env.BUCKET) throw new Error("照片存储暂不可用，请稍后重试");
  return env.BUCKET;
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function memberFromRequest(request: Request): Promise<Member | null> {
  const cookieToken = request.headers.get("cookie")?.match(/(?:^|;\s*)food-map-session=([^;]+)/)?.[1];
  if (cookieToken && cookieToken.length <= 200) {
    const fromSession = await db().prepare(`SELECT m.id, m.name, m.color, m.is_owner AS isOwner,
      (m.wechat_openid IS NOT NULL) AS wechatLinked FROM member_sessions s
      JOIN members m ON m.id = s.member_id WHERE s.token_hash = ? AND s.created_at > ?`)
      .bind(await hashToken(cookieToken), Date.now() - 90 * 24 * 60 * 60_000).first<Member>();
    if (fromSession) return fromSession;
  }
  // The hosting platform's reverse proxy replaces the incoming `Authorization`
  // header with its own bearer token, so a member token sent there never arrives.
  // Carry it in `X-Food-Map-Token` instead; `Authorization` stays supported for
  // local runs and other hosts where nothing rewrites it.
  const token = (request.headers.get("x-food-map-token") || "").trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
    || "";
  if (!token || token.length > 200) return null;
  return await db().prepare(`SELECT id, name, color, is_owner AS isOwner,
    (wechat_openid IS NOT NULL) AS wechatLinked FROM members WHERE token_hash = ?`)
    .bind(await hashToken(token)).first<Member>();
}

export function canManage(member: Member | null, creatorId: string) {
  return !!member && (member.id === creatorId || !!member.isOwner);
}

export function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function serverError(error: unknown) {
  console.error(error);
  return fail("服务暂不可用，请稍后重试", 500);
}

export function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

// Optional numeric field: absent/blank/garbage/out-of-range all become null. Used for the
// third-party values read off a screenshot, where "the screenshot does not show it" must
// stay distinguishable from a real value — never coerce a missing评分 into 0.
export function optionalNumber(value: unknown, min: number, max: number, integer: boolean) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return integer ? Math.round(parsed) : Math.round(parsed * 10) / 10;
}

export function isValidColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function parseJson(request: Request): Promise<Record<string, unknown>> {
  return request.json().then((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("无效输入");
    return value as Record<string, unknown>;
  });
}
