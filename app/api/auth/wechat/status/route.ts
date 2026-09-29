import { env } from "cloudflare:workers";

export function GET() {
  return Response.json({ enabled: !!(env.WECHAT_APP_ID && env.WECHAT_APP_SECRET && env.PUBLIC_SITE_URL) });
}
