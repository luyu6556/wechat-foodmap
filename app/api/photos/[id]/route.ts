import { bucket, db, fail, serverError } from "../../../../lib/server";

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
