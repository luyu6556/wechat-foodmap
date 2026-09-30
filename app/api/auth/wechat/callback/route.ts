import { env } from "cloudflare:workers";
import { db, hashToken } from "../../../../../lib/server";
import { DEFAULT_MEMBER_COLOR } from "../../../../../lib/color";

function redirect(error = false, session?: string) {
  const url = new URL(env.PUBLIC_SITE_URL || "https://example.invalid");
  if (error) url.searchParams.set("auth_error", "1");
  const headers = new Headers({ Location: url.toString() });
  headers.append("Set-Cookie", "food-map-oauth-state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  if (session) headers.append("Set-Cookie", `food-map-session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000`);
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request) {
  try {
    if (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET || !env.PUBLIC_SITE_URL) return redirect(true);
    const url = new URL(request.url);
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)food-map-oauth-state=([^;]+)/)?.[1];
    if (!code || !state || state !== cookie) return redirect(true);
    const database = db();
    const pending = await database.prepare("SELECT member_id AS memberId, created_at AS createdAt FROM oauth_states WHERE id = ?")
      .bind(state).first<{ memberId: string | null; createdAt: number }>();
    if (!pending || pending.createdAt < Date.now() - 10 * 60_000) return redirect(true);
    await database.prepare("DELETE FROM oauth_states WHERE id = ?").bind(state).run();

    const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
    tokenUrl.searchParams.set("appid", env.WECHAT_APP_ID);
    tokenUrl.searchParams.set("secret", env.WECHAT_APP_SECRET);
    tokenUrl.searchParams.set("code", code);
    tokenUrl.searchParams.set("grant_type", "authorization_code");
    const response = await fetch(tokenUrl, { signal: AbortSignal.timeout(8000) });
    const result = await response.json() as { openid?: string; errcode?: number };
    if (!response.ok || !result.openid || result.errcode) return redirect(true);

    let member = await database.prepare("SELECT id FROM members WHERE wechat_openid = ?")
      .bind(result.openid).first<{ id: string }>();
    if (!member && pending.memberId) {
      const claimed = await database.prepare("UPDATE members SET wechat_openid = ? WHERE id = ? AND wechat_openid IS NULL")
        .bind(result.openid, pending.memberId).run();
      if (claimed.meta.changes) member = { id: pending.memberId };
    }
    if (!member) {
      const id = crypto.randomUUID();
      await database.prepare(`INSERT INTO members (id, token_hash, name, color, wechat_openid, created_at)
        VALUES (?, ?, '', ?, ?, ?)`).bind(id, await hashToken(crypto.randomUUID()), DEFAULT_MEMBER_COLOR, result.openid, Date.now()).run();
      member = { id };
    }
    const session = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    await database.prepare("INSERT INTO member_sessions (token_hash, member_id, created_at) VALUES (?, ?, ?)")
      .bind(await hashToken(session), member.id, Date.now()).run();
    return redirect(false, session);
  } catch (error) {
    console.error("Wechat OAuth failed", error);
    return redirect(true);
  }
}
