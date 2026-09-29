import { bucket, canManage, db, fail, memberFromRequest, serverError } from "../../../../lib/server";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const row = await db().prepare("SELECT object_key AS objectKey, mime FROM photos WHERE id = ?")
      .bind(id).first<{ objectKey: string; mime: string }>();
    if (!row) return fail("照片不存在", 404);
    const object = await bucket().get(row.objectKey);
    if (!object) return fail("照片不存在", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": row.mime,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    const { id } = await context.params;
    const row = await db().prepare("SELECT member_id AS memberId, object_key AS objectKey FROM photos WHERE id = ?")
      .bind(id).first<{ memberId: string; objectKey: string }>();
    if (!row) return fail("照片不存在", 404);
    if (!canManage(member, row.memberId)) return fail("没有删除权限", 403);
    await db().prepare("DELETE FROM photos WHERE id = ?").bind(id).run();
    await bucket().delete(row.objectKey).catch((error) => console.error("Failed to remove deleted photo", error));
    return Response.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
