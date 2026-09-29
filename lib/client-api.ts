export class ApiError extends Error {
  existingId?: string;
  constructor(message: string, existingId?: string) {
    super(message);
    this.existingId = existingId;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window === "undefined" ? "" : localStorage.getItem("food-map-token") || "";
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as { error?: string; existingId?: string };
  if (!response.ok) throw new ApiError(data.error || "网络请求失败，请稍后重试", data.existingId);
  return data as T;
}

export function jsonBody(value: unknown) {
  return JSON.stringify(value);
}
