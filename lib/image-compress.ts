export async function preparePhoto(file: File): Promise<File> {
  if (file.size > 25 * 1024 * 1024) throw new Error("原图过大，请选择 25 MB 以下的照片");
  if (file.size <= 800_000 && file.type !== "image/heic" && file.type !== "image/heif") return file;

  let image: ImageBitmap | HTMLImageElement;
  try {
    image = await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const fallback = new Image();
      fallback.src = url;
      await fallback.decode();
      image = fallback;
    } catch {
      throw new Error("无法读取这张照片，请换一张 JPG 或 PNG 图片");
    } finally { URL.revokeObjectURL(url); }
  }

  const isBitmap = typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;
  const width = isBitmap ? image.width : (image as HTMLImageElement).naturalWidth;
  const height = isBitmap ? image.height : (image as HTMLImageElement).naturalHeight;
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("照片处理失败，请换一张重试");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (isBitmap) (image as ImageBitmap).close();

  let blob: Blob | null = null;
  for (const quality of [0.82, 0.72, 0.62]) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= 900_000) break;
  }
  if (!blob) throw new Error("照片处理失败，请换一张重试");
  if (blob.size > 8 * 1024 * 1024) throw new Error("照片仍然过大，请换一张重试");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
}
