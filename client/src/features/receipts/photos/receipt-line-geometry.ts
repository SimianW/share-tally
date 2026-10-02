// Azure image polygons use coordinates in the analyzed page's pixel space.
// The photo returned by the API may be resized, so map through page dimensions.
export function receiptLineGeometry(
  polygon: number[],
  page: { width: number; height: number },
  image: { width: number; height: number },
) {
  const { width, height } = image;
  if (
    !Number.isFinite(page.width) || !Number.isFinite(page.height) ||
    !Number.isFinite(width) || !Number.isFinite(height) ||
    page.width <= 0 || page.height <= 0 || width <= 0 || height <= 0 ||
    polygon.length < 6 || polygon.length % 2 !== 0 ||
    !polygon.every(Number.isFinite) ||
    // A different aspect ratio means the analyzed and displayed images are not
    // simply scaled versions of one another (e.g. a rotated/replaced photo).
    Math.abs(width / page.width / (height / page.height) - 1) > 0.02
  ) return null;

  const points = Array.from({ length: polygon.length / 2 }, (_, index) => ({
    x: polygon[index * 2] * width / page.width,
    y: polygon[index * 2 + 1] * height / page.height,
  }));
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  if (left < 0 || top < 0 || right > width || bottom > height || right <= left || bottom <= top) return null;

  const cropHeight = Math.min(height, Math.max((bottom - top) * 3, width / 3.5));
  const cropTop = Math.max(0, Math.min(height - cropHeight, (top + bottom - cropHeight) / 2));
  return { viewBox: `0 ${cropTop} ${width} ${cropHeight}`, points: points.map(({ x, y }) => `${x},${y}`).join(" ") };
}
