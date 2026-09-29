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
    const html = (await response.text()).slice(0, 350_000);
    const title = html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]
      || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
      || "";
    return title.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s*[-｜|_].*(美团|大众点评).*$/g, "").trim().slice(0, 80);
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
