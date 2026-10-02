import { loadPhotoResource, localPhotoBlob } from './photo-resource';
import { Scan } from "lucide-react";
import { useEffect, useState } from "react";
import { useReceiptApi } from "../api";
import { ReceiptPhotoViewer } from "./ReceiptPhotoViewer";
export function ReceiptPhoto({
  id,
  version = 0,
  expired = false,
  localPhoto,
  review = false,
  subject,
}: {
  id: string;
  version?: number;
  expired?: boolean;
  localPhoto?: string;
  review?: boolean;
  subject?: string;
}) {
  const api = useReceiptApi();
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (expired && !localPhoto) return;
    return loadPhotoResource(
      signal => localPhoto ? Promise.resolve(localPhotoBlob(localPhoto)) : api.photo(id, signal),
      url => { setImage(url); setError(''); },
      () => setError('Photo unavailable or expired.'),
    );
  }, [api, id, version, expired, localPhoto]);
  const source = image;
  if (expired && !localPhoto)
    return (
      <p>
        Receipt photo expired after six months. Item data and original text are
        retained.
      </p>
    );
  return (
    <>
      <div className={`receipt-photo${review ? " receipt-photo-review" : ""}`}>
        <div className="receipt-photo-label eyebrow">SOURCE RECEIPT</div>
        {error && !localPhoto ? <p>{error}</p> : source ? (
          <button type="button" className="receipt-photo-open" aria-label="View receipt photo" onClick={() => setOpen(true)}>
            <img src={source} alt="Original cropped receipt" onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
            <span className="receipt-zoom-hint"><Scan size={16} aria-hidden="true" /></span>
          </button>
        ) : <p>Loading photo…</p>}
        <small>Photos are kept for six months.</small>
      </div>
      {open && dimensions && <ReceiptPhotoViewer image={{ url: source, ...dimensions }} subject={subject} close={() => setOpen(false)} />}
    </>
  );
}
