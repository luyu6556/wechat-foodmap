import { env } from "cloudflare:workers";

type Context = { params: Promise<{ proxy: string[] }> };

export async function GET(request: Request, context: Context) {
  if (!env.AMAP_WEB_KEY || !env.AMAP_SECURITY_JS_CODE) return new Response("Map service unavailable", { status: 503 });
  const { proxy } = await context.params;
  if (proxy?.[0] !== "_AMapService") return new Response("Invalid map request", { status: 404 });
  const path = proxy.slice(1);
  if (!path.length || !["v3", "v4", "v5"].includes(path[0]) || !path.every((segment) => /^[a-zA-Z0-9_-]+$/.test(segment))) {
    return new Response("Invalid map request", { status: 400 });
  }
  const input = new URL(request.url);
  if (input.searchParams.get("key") !== env.AMAP_WEB_KEY) return new Response("Invalid map key", { status: 403 });
  const upstream = new URL(`https://restapi.amap.com/${path.join("/")}`);
  input.searchParams.forEach((value, key) => { if (key !== "jscode") upstream.searchParams.set(key, value); });
  upstream.searchParams.set("jscode", env.AMAP_SECURITY_JS_CODE);
  try {
    const response = await fetch(upstream, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    if (response.status >= 300 && response.status < 400) return new Response("Map service redirect blocked", { status: 502 });
    return new Response(response.body, { status: response.status, headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json",
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch { return new Response("Map service unavailable", { status: 502 }); }
}
