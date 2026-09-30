import { clean, fail, parseJson, serverError } from "../../../lib/server";
import { defaultCity } from "../../../lib/geo";
import { recognizeScreenshot } from "../../../lib/vision";

// Messages the vision helper raises that are safe and useful to show the user as-is.
// Anything else is an internal fault and must not leak details.
const REPORTABLE = new Set([
  "截图识别尚未配置",
  "截图识别密钥无效",
  "截图识别服务暂不可用",
  "没能读懂这张截图，请手动填写",
  "图片过大，请换一张更小的截图",
]);

const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

export async function POST(request: Request) {
  try {
    const body = await parseJson(request);
    // Accept both a bare base64 payload and a `data:` URL from the browser.
    const image = typeof body.image === "string"
      ? body.image.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s+/g, "")
      : "";
    if (!image) return fail("请先选择一张截图");
    if (!BASE64_RE.test(image)) return fail("图片格式无法识别，请重新选择");
    // The shop's city is not always printed on the screenshot; the caller may pass one.
    const city = clean(body.city, 20) || defaultCity();

    const resolved = await recognizeScreenshot(image, city);
    // Deliberately not persisted here: the user reviews the fields in the dialog and the
    // normal POST /api/places write path stores whatever they confirm. A wrong read must
    // never reach the database unseen.
    return Response.json({ resolved });
  } catch (error) {
    if (error instanceof Error && REPORTABLE.has(error.message)) return fail(error.message, 502);
    return serverError(error);
  }
}
