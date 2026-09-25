import { useEffect, useState } from "react";
import { useReceiptApi } from "./receipt-api";
import { receiptLineGeometry } from "./receipt-line-geometry";

// This crop is only shown in the item editor. The review photo remains independent:
// moving through items must not move or scroll the photo beside the list.
export function ReceiptLinePhoto({ id, version, page, polygon }: {
  id: string;
  version: number;
  page: { width: number; height: number; unit: string };
  polygon: number[];
}) {
  const api = useReceiptApi();
  const [photo, setPhoto] = useState<{ id: string; version: number; url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    void api.photo(id, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        if (!controller.signal.aborted)
          setPhoto({ id, version, url, width: image.naturalWidth, height: image.naturalHeight });
      };
      image.src = url;
    }).catch(() => {
      if (!controller.signal.aborted) setPhoto(null);
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, id, version]);

  // Azure returns pixel coordinates for image pages; PDF/inch pages do not
  // describe the uploaded JPEG and must never be overlaid on it.
  const geometry = photo?.id === id && photo.version === version && page.unit === "pixel"
    ? receiptLineGeometry(polygon, page, photo)
    : null;
  if (!geometry || !photo) return null;
  return <div className="receipt-editor-photo">
    <span className="eyebrow">ITEM ON THE RECEIPT</span>
    <svg role="img" aria-label="Receipt line" viewBox={geometry.viewBox}>
      <image href={photo.url} width={photo.width} height={photo.height} />
      <polygon role="img" aria-label="Highlighted receipt line" points={geometry.points} />
    </svg>
  </div>;
}
