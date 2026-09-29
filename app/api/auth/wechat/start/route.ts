import { env } from "cloudflare:workers";
import { db, fail, memberFromRequest, serverError } from "../../../../../lib/server";

export async function POST(request: Request) {
  try {
    if (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET || !env.PUBLIC_SITE_URL) return fail("微信授权尚未配置", 503);
    const origin = new URL(env.PUBLIC_SITE_URL);
    if (origin.protocol !== "https:") return fail("微信授权网址配置错误", 503);
    const member = await memberFromRequest(request);
    const state = crypto.randomUUID();
    const now = Date.now();
    await db().prepare("DELETE FROM oauth_states WHERE created_at < ?").bind(now - 10 * 60_000).run();
    await db().prepare("INSERT INTO oauth_states (id, member_id, created_at) VALUES (?, ?, ?)")
      .bind(state, member?.id || null, now).run();
    const callback = new URL("/api/auth/wechat/callback", origin);
    const auth = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
    auth.searchParams.set("appid", env.WECHAT_APP_ID);
    auth.searchParams.set("redirect_uri", callback.toString());
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "snsapi_base");
    auth.searchParams.set("state", state);
    auth.hash = "wechat_redirect";
    return Response.json({ url: auth.toString() }, {
      headers: { "Set-Cookie": `food-map-oauth-state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600` },
    });
  } catch (error) { return serverError(error); }
}
