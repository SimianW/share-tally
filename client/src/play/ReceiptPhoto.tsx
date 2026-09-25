import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";
import { useReceiptApi } from "./receipt-api";
import Dialog from "./Dialog";
import { ZoomIn, ZoomOut, Scan } from "lucide-react";
export function ReceiptPhoto({
  id,
  version = 0,
  expired = false,
  localPhoto,
  review = false,
}: {
  id: string;
  version?: number;
  expired?: boolean;
  localPhoto?: string;
  review?: boolean;
}) {
  const api = useReceiptApi();
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (expired && !localPhoto) return;
    const controller = new AbortController();
    let url = "";
    const photo = localPhoto
      ? Promise.resolve(
          new Blob(
            [
              Uint8Array.from(atob(localPhoto), (character) =>
                character.charCodeAt(0),
              ),
            ],
            { type: "image/jpeg" },
          ),
        )
      : api.photo(id, controller.signal);
    photo
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage(url);
        setError("");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Photo unavailable or expired.");
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
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
          <button type="button" className="receipt-photo-open" aria-label="View receipt photo" onClick={() => { setZoom(1); setOpen(true); }}>
            <img src={source} alt="Original cropped receipt" />
            <span><Scan size={16} aria-hidden="true" /> Tap to zoom</span>
          </button>
        ) : <p>Loading photo…</p>}
        <small>Photos are kept for six months.</small>
      </div>
      {open && <Dialog title="Receipt photo" kicker="SOURCE RECEIPT" className="receipt-photo-viewer" closeLabel="Close photo" close={() => setOpen(false)}>
        <div className="receipt-photo-tools">
          <button type="button" className="button secondary" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.5))}><ZoomOut size={18} /></button>
          <output aria-label="Photo zoom">{Math.round(zoom * 100)}%</output>
          <button type="button" className="button secondary" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.5))}><ZoomIn size={18} /></button>
          <Button variant="text" onClick={() => setZoom(1)}>Fit photo</Button>
        </div>
        <div className="receipt-photo-viewport" tabIndex={0} aria-label="Zoomed receipt photo; scroll to pan">
          <img src={source} alt="Full-size original receipt" style={{ width: `${zoom * 100}%` }} />
        </div>
      </Dialog>}
    </>
  );
}
export function ReceiptCrop({
  file,
  save,
  cancel,
}: {
  file: File;
  save: (base64: string) => Promise<void>;
  cancel: () => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState({
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const element = image.current;
    if (element) element.src = url;
    return () => {
      if (element) element.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [file]);
  async function upload() {
    const img = image.current;
    if (!img?.naturalWidth) return;
    setBusy(true);
    setError("");
    try {
      const x = (img.naturalWidth * crop.left) / 100,
        y = (img.naturalHeight * crop.top) / 100;
      const width = (img.naturalWidth * (crop.right - crop.left)) / 100,
        height = (img.naturalHeight * (crop.bottom - crop.top)) / 100;
      const ratio = Math.min(1, 2400 / width, 6000 / height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      canvas
        .getContext("2d")!
        .drawImage(img, x, y, width, height, 0, 0, canvas.width, canvas.height);
      await save(canvas.toDataURL("image/jpeg", 0.9).split(",")[1]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload this photo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="receipt-crop">
      <h3>Just the receipt</h3>
      <p>Trim the edges if you like. Only the cropped photo is uploaded.</p>
      <div className="receipt-crop-preview">
        <img
          ref={image}
          alt="Receipt to crop"
          onError={() =>
            setError(
              "This image could not be opened. Choose JPEG, PNG or WebP.",
            )
          }
        />
        <div
          style={{
            left: `${crop.left}%`,
            top: `${crop.top}%`,
            right: `${100 - crop.right}%`,
            bottom: `${100 - crop.bottom}%`,
          }}
        />
      </div>
      <fieldset disabled={busy} className="receipt-crop-sliders">
        {(["left", "right", "top", "bottom"] as const).map((edge) => (
          <label key={edge}>
            {edge}
            <input
              type="range"
              aria-label={`Crop ${edge}`}
              min={
                edge === "right"
                  ? crop.left + 5
                  : edge === "bottom"
                    ? crop.top + 5
                    : 0
              }
              max={
                edge === "left"
                  ? crop.right - 5
                  : edge === "top"
                    ? crop.bottom - 5
                    : 100
              }
              value={crop[edge]}
              onChange={(e) =>
                setCrop({ ...crop, [edge]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <Button disabled={busy} onClick={() => void upload()}>
          {busy ? "Uploading…" : "Use this photo"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={cancel}>
          Choose another
        </Button>
      </div>
    </section>
  );
}
