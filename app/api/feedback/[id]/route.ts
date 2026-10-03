import { db, fail, memberFromRequest, serverError } from "../../../../lib/server";

type Context = { params: Promise<{ id: string }> };

// 只有群主能删。删掉就是真删，不做回收站 —— 反馈是临时记录，不是群里的资产。
export async function DELETE(request: Request, context: Context) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    if (!member.isOwner) return fail("只有群主能删反馈", 403);
    const { id } = await context.params;
    const result = await db().prepare("DELETE FROM feedback WHERE id = ?").bind(id).run();
    if (!result.meta.changes) return fail("这条反馈已经不在了", 404);
    return Response.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
