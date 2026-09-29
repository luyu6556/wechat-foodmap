import { clean, fail, parseJson, serverError } from "../../../lib/server";
import { resolveSharedText } from "../../../lib/resolve";

const SAFE_HOSTS = ["meituan.com", "dianping.com", "dpurl.cn"];

function safeHost(host: string) {
  return SAFE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

async function remoteTitle(inputUrl: string): Promise<string> {
  let url = new URL(inputUrl);
  for (let i = 0; i < 3; i++) {
    if (url.protocol !== "https:" || !safeHost(url.hostname)) return "";
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FoodMap/1.0)" },
      redirect: "manual",
      signal: AbortSignal.timeout(4500),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return "";
      url = new URL(location, url);
      continue;
    }
    if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) return "";
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 350_000) return "";
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (size <= 350_000) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 350_000) return "";
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const html = new TextDecoder().decode(bytes);
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    const tag = tags.find((item) => /(?:property|name)\s*=\s*["']og:title["']/i.test(item));
    const title = tag?.match(/content\s*=\s*["']([^"']+)/i)?.[1]
      || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
    const cleaned = title.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s*[-｜|_].*(美团|大众点评).*$/g, "").trim().slice(0, 80);
    return /^(美团|大众点评|登录|分享)$/i.test(cleaned) ? "" : cleaned;
  }
  return "";
}

export async function POST(request: Request) {
  try {
    const body = await parseJson(request);
    const text = clean(body.text, 3000);
    if (!text) return fail("请粘贴地点分享内容");
    const resolved = resolveSharedText(text);
    if (!resolved.name && resolved.sourceUrl && ["美团", "大众点评"].includes(resolved.sourcePlatform)) {
      try {
        const title = await remoteTitle(resolved.sourceUrl);
        if (title) resolved.name = title;
      } catch {
        // These sites may require app-only access; manual confirmation remains available.
      }
    }
    return Response.json({ resolved });
  } catch (error) {
    return serverError(error);
  }
}
