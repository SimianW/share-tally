import sharp from "sharp";
import { BillError } from "../shared/bill-error.js";

export const NOTE_PHOTO_MAX_BYTES = 1.5 * 1024 * 1024;

// The stored photo is this re-encoding, never the upload: orientation is
// applied, then every metadata block, including EXIF and GPS, is dropped.
export async function normalizeNotePhoto(base64: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    throw new BillError(400, "Invalid image data.");
  const source = Buffer.from(base64, "base64");
  if (source.length > NOTE_PHOTO_MAX_BYTES)
    throw new BillError(413, "Choose a photo smaller than 1.5 MB.");
  try {
    const image = sharp(source, { limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(metadata.format || "") ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error();
    return await image
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      // JPEG has no transparency; show transparent areas as white, not black.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    throw new BillError(400, "Choose a JPEG, PNG or WebP photo.");
  }
}
