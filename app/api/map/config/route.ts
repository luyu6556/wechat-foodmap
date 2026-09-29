import { env } from "cloudflare:workers";

export function GET() {
  return Response.json(env.AMAP_WEB_KEY && env.AMAP_SECURITY_JS_CODE
    ? { provider: "amap", key: env.AMAP_WEB_KEY }
    : { provider: "osm" });
}
