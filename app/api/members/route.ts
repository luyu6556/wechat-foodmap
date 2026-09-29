import { clean, db, fail, hashToken, isValidColor, parseJson, serverError } from "../../../lib/server";

export async function POST(request: Request) {
  try {
    const body = await parseJson(request);
    const name = clean(body.name, 24);
    const color = clean(body.color, 7);
    if (!name) return fail("请填写昵称");
    if (!isValidColor(color)) return fail("请选择颜色");
    const id = crypto.randomUUID();
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    await db().prepare("INSERT INTO members (id, token_hash, name, color, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, await hashToken(token), name, color, Date.now()).run();
    return Response.json({ member: { id, name, color, isOwner: 0, wechatLinked: 0 }, token }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
