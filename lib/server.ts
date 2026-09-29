import { env } from "cloudflare:workers";

export type Member = { id: string; name: string; color: string };

export function db(): D1Database {
  if (!env.DB) throw new Error("数据库暂不可用，请稍后重试");
  return env.DB;
}

export function bucket(): R2Bucket {
  if (!env.BUCKET) throw new Error("照片存储暂不可用，请稍后重试");
  return env.BUCKET;
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function memberFromRequest(request: Request): Promise<Member | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length > 200) return null;
  return await db().prepare("SELECT id, name, color FROM members WHERE token_hash = ?")
    .bind(await hashToken(token)).first<Member>();
}

export function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function serverError(error: unknown) {
  console.error(error);
  return fail("服务暂不可用，请稍后重试", 500);
}

export function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function isValidColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function parseJson(request: Request): Promise<Record<string, unknown>> {
  return request.json().then((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("无效输入");
    return value as Record<string, unknown>;
  });
}
