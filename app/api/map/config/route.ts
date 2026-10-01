import { env } from "cloudflare:workers";

export function GET() {
  if (!env.AMAP_WEB_KEY) return Response.json({ provider: "osm" });
  // 高德 2021-12-02 之后新建的 key 必须配安全密钥，更早的 key 没有这一项。
  // 因此这里不再硬性要求 AMAP_SECURITY_JS_CODE：
  //   有安全密钥 → useProxy，走同源代理由服务端注入 jscode（密钥不出服务端，更安全）；
  //   没有       → 直连高德服务（实测老 key 可以直接出底图）。
  return Response.json({
    provider: "amap",
    key: env.AMAP_WEB_KEY,
    useProxy: Boolean(env.AMAP_SECURITY_JS_CODE),
  });
}
