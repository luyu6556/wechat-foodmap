import { clean, fail, parseJson, serverError } from "../../../lib/server";
import { defaultCity, locate } from "../../../lib/geo";

const REPORTABLE = new Set([
  "自动定位尚未配置",
  "定位服务密钥校验失败",
  "定位服务今日额度已用完",
  "定位服务暂不可用",
]);

export async function POST(request: Request) {
  try {
    const body = await parseJson(request);
    const name = clean(body.name, 80);
    const address = clean(body.address, 200);
    const city = clean(body.city, 20) || defaultCity();
    if (!name && !address) return fail("请先填写店名或地址");

    const located = await locate(name, address, city);
    // Never fail the request just because the pin is uncertain: lat/lng come back null and
    // the dialog falls back to asking the user to tap the map, which is the same contract
    // the link-based import already follows.
    return Response.json({ located });
  } catch (error) {
    if (error instanceof Error && REPORTABLE.has(error.message)) return fail(error.message, 502);
    return serverError(error);
  }
}
