import { canManage, clean, db, fail, memberFromRequest, parseJson, serverError } from "../../../../lib/server";

type Context = { params: Promise<{ id: string }> };

async function authorize(request: Request, id: string) {
  const member = await memberFromRequest(request);
  if (!member) return { error: fail("请先设置昵称", 401) };
  const row = await db().prepare("SELECT member_id AS memberId FROM comments WHERE id = ?")
    .bind(id).first<{ memberId: string }>();
  if (!row) return { error: fail("评论不存在", 404) };
  if (!canManage(member, row.memberId)) return { error: fail("没有修改权限", 403) };
  return { error: null };
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { error } = await authorize(request, id);
    if (error) return error;
    const body = await parseJson(request);
    const text = clean(body.body, 500);
    if (!text) return fail("请输入评论");
    await db().prepare("UPDATE comments SET body = ? WHERE id = ?").bind(text, id).run();
    return Response.json({ ok: true });
  } catch (error) { return serverError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { error } = await authorize(request, id);
    if (error) return error;
    await db().prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
    return Response.json({ ok: true });
  } catch (error) { return serverError(error); }
}
