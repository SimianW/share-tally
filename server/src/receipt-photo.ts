import sharp from "sharp";
import { BillError } from "./bill-error.js";

// Kept free of database imports so the benchmark recorder submits exactly what production submits to Azure.
export async function normalizeReceiptPhoto(base64: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    throw new BillError(400, "Invalid image data.");
  const source = Buffer.from(base64, "base64");
  if (source.length > 8 * 1024 * 1024)
    throw new BillError(413, "Choose a photo smaller than 8 MB.");
  let bytes: Buffer;
  try {
    const image = sharp(source, { limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(metadata.format || "") ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error();
    bytes = await image
      .rotate()
      .resize({
        width: 2400,
        height: 6000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw new BillError(400, "Choose a valid JPEG, PNG or WebP receipt photo.");
  }
  return bytes;
}
