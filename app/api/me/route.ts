import { clean, db, fail, isValidColor, memberFromRequest, parseJson, serverError } from "../../../lib/server";
import { normalizeColor } from "../../../lib/color";

export async function GET(request: Request) {
  try {
    const member = await memberFromRequest(request);
    return member ? Response.json({ member }) : fail("请先设置昵称", 401);
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    const body = await parseJson(request);
    const name = clean(body.name, 24);
    const submitted = clean(body.color, 7);
    if (!name || !isValidColor(submitted)) return fail("请填写昵称并选择颜色");
    // 存量客户端可能还在提交旧色板的值，落库前统一换算，库里不留旧色。
    const color = normalizeColor(submitted);
    await db().prepare("UPDATE members SET name = ?, color = ? WHERE id = ?").bind(name, color, member.id).run();
    return Response.json({ member: { ...member, name, color } });
  } catch (error) {
    return serverError(error);
  }
}
