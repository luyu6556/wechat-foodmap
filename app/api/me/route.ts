import { clean, db, fail, isValidColor, memberFromRequest, parseJson, serverError } from "../../../lib/server";

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
    const color = clean(body.color, 7);
    if (!name || !isValidColor(color)) return fail("请填写昵称并选择颜色");
    await db().prepare("UPDATE members SET name = ?, color = ? WHERE id = ?").bind(name, color, member.id).run();
    return Response.json({ member: { ...member, name, color } });
  } catch (error) {
    return serverError(error);
  }
}
