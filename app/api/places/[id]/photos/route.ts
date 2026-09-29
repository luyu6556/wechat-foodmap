import { bucket, db, fail, memberFromRequest, serverError } from "../../../../../lib/server";

type Context = { params: Promise<{ id: string }> };
const MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function POST(request: Request, context: Context) {
  try {
    const member = await memberFromRequest(request);
    if (!member) return fail("请先设置昵称", 401);
    const { id } = await context.params;
    const database = db();
    if (!await database.prepare("SELECT id FROM places WHERE id = ?").bind(id).first()) return fail("地点不存在", 404);
    const form = await request.formData();
    const file = form.get("photo");
    if (!(file instanceof File)) return fail("请选择照片");
    if (!MIME.has(file.type)) return fail("请上传 JPG、PNG、WebP 或 HEIC 图片");
    if (file.size < 1 || file.size > 8 * 1024 * 1024) return fail("单张照片不能超过 8 MB");
    const photoId = crypto.randomUUID();
    const key = `places/${id}/${photoId}`;
    await bucket().put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    try {
      await database.prepare("INSERT INTO photos (id, place_id, member_id, object_key, mime, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(photoId, id, member.id, key, file.type, Date.now()).run();
    } catch (error) {
      await bucket().delete(key);
      throw error;
    }
    return Response.json({ id: photoId }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
