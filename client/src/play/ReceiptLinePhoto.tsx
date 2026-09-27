import { useEffect, useState, type ReactNode } from "react";
import { Scan } from "lucide-react";
import { ReceiptPhotoViewer } from "./ReceiptPhotoViewer";
import { useReceiptApi } from "./receipt-api";
import { receiptLineGeometry } from "./receipt-line-geometry";

// This crop is shown in the item editor and the claim sheet. The review photo remains
// independent: moving through items must not move or scroll the photo beside the list.
// `fallback` replaces the crop once it is known that the line cannot be drawn.
export function ReceiptLinePhoto({ id, version, page, polygon, subject, fallback = null }: {
  id: string;
  version: number;
  page: { width: number; height: number; unit: string };
  polygon: number[];
  subject?: string;
  fallback?: ReactNode;
}) {
  const api = useReceiptApi();
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<{ id: string; version: number; url: string; width: number; height: number } | { id: string; version: number; failed: true } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    const fail = () => {
      if (!controller.signal.aborted) setPhoto({ id, version, failed: true });
    };
    void api.photo(id, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        if (!controller.signal.aborted)
          setPhoto({ id, version, url, width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = fail;
      image.src = url;
    }).catch(fail);
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, id, version]);

  const current = photo?.id === id && photo.version === version ? photo : null;
  // Azure returns pixel coordinates for image pages; PDF/inch pages do not
  // describe the uploaded JPEG and must never be overlaid on it.
  const loaded = current && !("failed" in current) ? current : null;
  const geometry = loaded && page.unit === "pixel"
    ? receiptLineGeometry(polygon, page, loaded)
    : null;
  if (!geometry || !loaded) return page.unit !== "pixel" || current ? fallback : null;
  return <>
    <div className="receipt-editor-photo">
      <span className="eyebrow">ITEM ON THE RECEIPT</span>
      <button type="button" className="receipt-photo-open receipt-line-open" aria-label="View whole receipt" onClick={() => setOpen(true)}>
        <svg role="img" aria-label="Receipt line" viewBox={geometry.viewBox}>
          <image href={loaded.url} width={loaded.width} height={loaded.height} />
          <polygon role="img" aria-label="Highlighted receipt line" points={geometry.points} />
        </svg>
        <span><Scan size={16} aria-hidden="true" /> Tap to zoom</span>
      </button>
    </div>
    {open && <ReceiptPhotoViewer image={loaded} points={geometry.points} subject={subject} close={() => setOpen(false)} />}
  </>;
}
