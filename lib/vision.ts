import { env } from "cloudflare:workers";
import { optionalNumber } from "./server";

export type RecognizedPlace = {
  name: string;
  cuisine: string;
  platformRating: number | null;
  ratingCount: number | null;
  avgPrice: number | null;
  address: string;
  city: string;
  district: string;
  rawText: string;
  message: string;
};

// Verified 2026-09-30 against two real 美团/大众点评 screenshots: the model returned the
// right name, cuisine, rating and per-capita price, and correctly returned null for the
// shop that showed 「暂无星级」 and no price. Keep the 「看不清就填 null」 clause — it is
// what stops the model from inventing a coordinate-adjacent number that looks plausible.
const PROMPT = `你是餐饮信息提取助手。看这张美团或大众点评的店铺截图，只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。

字段定义：
- name：商户全名（含括号里的分店名），没有就 null
- cuisine：菜系或品类，例如「新疆菜」「东北家常菜」；没有就 null
- platform_rating：平台评分数字，例如 4.0；图中写「暂无星级」就 null
- rating_count：评价条数整数，例如 2280；没有就 null
- avg_price：人均价格整数（元），例如 36；没有就 null
- address：地址（含行政区前缀，尽量完整），没有就 null
- city：城市名，从地址推断，推断不出就 null
- district：行政区，例如「天河区」，没有就 null
- raw_text：截图中与上面字段直接相关的原文片段

铁律：看不清或图中没有的字段填 null，绝对不要猜测或编造数字。只输出 JSON。`;

const DISTRICT_RE = /([\u4e00-\u9fa5]{2,10}?(?:区|县|市|镇))/;

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

// Models often wrap JSON in ```json fences despite instructions. Take the outermost braces.
function extractJson(content: string): Record<string, unknown> | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(content.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function normalizeRecognized(raw: Record<string, unknown>, fallbackCity: string): RecognizedPlace {
  const name = text(raw.name, 80);
  const cuisine = text(raw.cuisine, 20);
  const addressRaw = text(raw.address, 200);
  // District is often visible in the address even when the model leaves the field empty,
  // so recover it with a rule rather than trusting the model to repeat itself.
  const district = text(raw.district, 20) || addressRaw.match(DISTRICT_RE)?.[1] || "";
  // The model sometimes drops the district prefix from the address (observed: it returned
  // 「天河北路76号新疆大厦2-3楼」 for 「天河区天河北路76号…」). Geocoding needs it back.
  const address = district && addressRaw && !addressRaw.startsWith(district)
    ? `${district}${addressRaw}`
    : addressRaw;
  const city = text(raw.city, 20) || fallbackCity;
  const found = !!(name || cuisine || address);
  return {
    name,
    cuisine,
    platformRating: optionalNumber(raw.platform_rating, 0, 5, false),
    ratingCount: optionalNumber(raw.rating_count, 0, 10_000_000, true),
    avgPrice: optionalNumber(raw.avg_price, 0, 100_000, true),
    address,
    city,
    district,
    rawText: text(raw.raw_text, 600),
    message: found
      ? "已从截图识别，请核对每一项后再保存。"
      : "截图里没有读到可用信息，请手动填写。",
  };
}

export async function recognizeScreenshot(imageBase64: string, fallbackCity: string): Promise<RecognizedPlace> {
  const apiKey = env.ZHIPU_API_KEY;
  if (!apiKey) throw new Error("截图识别尚未配置");
  if (imageBase64.length > 5_000_000) throw new Error("图片过大，请换一张更小的截图");

  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.ZHIPU_VISION_MODEL || "glm-4v-flash",
      // Zhipu takes the raw base64 without a `data:` prefix (verified).
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageBase64 } },
          { type: "text", text: PROMPT },
        ],
      }],
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("vision api failed", response.status, detail.slice(0, 300));
    throw new Error(response.status === 401 ? "截图识别密钥无效" : "截图识别服务暂不可用");
  }

  const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content || "";
  const parsed = extractJson(content);
  if (!parsed) {
    console.error("vision output was not json", content.slice(0, 300));
    throw new Error("没能读懂这张截图，请手动填写");
  }
  return normalizeRecognized(parsed, fallbackCity);
}
