export type Region = { x: number; y: number; width: number; height: number };

/** Draws `region` of a decoded picture onto a new canvas, scaled by `ratio` (at least 1 px per side). */
export function scaledCanvas(source: CanvasImageSource, region: Region, ratio: number, background?: string) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(region.width * ratio));
  canvas.height = Math.max(1, Math.round(region.height * ratio));
  const context = canvas.getContext("2d")!;
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const NOTE_PHOTO_EDGE = 2048;
const NOTE_PHOTO_TARGET = 1024 * 1024;
/** The server's limit; a result above it would only be rejected after uploading. */
const NOTE_PHOTO_LIMIT = 1.5 * 1024 * 1024;

export class UnreadablePhotoError extends Error {}

/**
 * Shrinks a picked picture to at most 2048 px on its long edge as JPEG at
 * quality 0.8, stepping down to 0.6 while it is over 1 MB. Returns base64.
 */
export async function compressNotePhoto(file: Blob) {
  let bitmap: ImageBitmap;
  try {
    // Decoding applies the picture's EXIF orientation.
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UnreadablePhotoError("This browser can't open that picture. Choose a JPEG, PNG or WebP image.");
  }
  try {
    const { width, height } = bitmap;
    const ratio = Math.min(1, NOTE_PHOTO_EDGE / Math.max(width, height));
    // JPEG has no transparency; transparent areas become white rather than black.
    const canvas = scaledCanvas(bitmap, { x: 0, y: 0, width, height }, ratio, "#ffffff");
    let blob: Blob | null = null;
    for (const quality of [0.8, 0.7, 0.6]) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) throw new UnreadablePhotoError("This picture couldn't be prepared for upload. Try another one.");
      if (blob.size <= NOTE_PHOTO_TARGET) break;
    }
    if (blob!.size > NOTE_PHOTO_LIMIT)
      throw new UnreadablePhotoError("This picture is too detailed to upload. Try another one.");
    return blobBase64(blob!);
  } finally {
    bitmap.close();
  }
}

async function blobBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // Spread in chunks; one call with every byte would exceed the argument limit.
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}
