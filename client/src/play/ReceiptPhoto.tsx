import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "./ui";
import { useReceiptApi } from "./receipt-api";
import { RotateCcw, Scan } from "lucide-react";
import Dialog from "./Dialog";
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
type Crop = { left: number; top: number; right: number; bottom: number };
type Edge = keyof Crop;
type Handle = {
  edges: readonly Edge[];
  label: string;
  className: string;
};
const FULL_CROP: Crop = { left: 0, top: 0, right: 100, bottom: 100 };
// Opposite handles stay at least one hit area plus a little air apart.
const HANDLE_HIT = 44;
const MIN_HANDLE_GAP = HANDLE_HIT + 4;
const HANDLES: readonly Handle[] = [
  { edges: ["top"], label: "Crop top edge", className: "edge top" },
  { edges: ["bottom"], label: "Crop bottom edge", className: "edge bottom" },
  { edges: ["left"], label: "Crop left edge", className: "edge left" },
  { edges: ["right"], label: "Crop right edge", className: "edge right" },
  { edges: ["left", "top"], label: "Crop top-left corner", className: "corner top-left" },
  { edges: ["right", "top"], label: "Crop top-right corner", className: "corner top-right" },
  { edges: ["left", "bottom"], label: "Crop bottom-left corner", className: "corner bottom-left" },
  { edges: ["right", "bottom"], label: "Crop bottom-right corner", className: "corner bottom-right" },
];
const horizontal = (edge: Edge) => edge === "left" || edge === "right";
const capitalized = (edge: Edge) => edge[0].toUpperCase() + edge.slice(1);

/** Moves the given edges, keeping them on the photo and apart from their opposite edge. */
function moveEdges(crop: Crop, next: Partial<Crop>, gap: { x: number; y: number }): Crop {
  const result = { ...crop };
  for (const edge of Object.keys(next) as Edge[]) {
    const [min, max] = edgeRange(crop, edge, gap);
    result[edge] = Math.min(Math.max(next[edge]!, min), max);
  }
  return result;
}
function edgeRange(crop: Crop, edge: Edge, gap: { x: number; y: number }) {
  if (edge === "left") return [0, Math.max(0, crop.right - gap.x)];
  if (edge === "right") return [Math.min(100, crop.left + gap.x), 100];
  if (edge === "top") return [0, Math.max(0, crop.bottom - gap.y)];
  return [Math.min(100, crop.top + gap.y), 100];
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
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; edges: readonly Edge[]; offset: Partial<Crop> } | null>(null);
  const [crop, setCrop] = useState<Crop>(FULL_CROP);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState<string | null>(null);
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
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      setSpace({
        width: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  // Contain-fit the photo into the space between the heading and the actions.
  const fit = natural && space.width > 0 && space.height > 0
    ? Math.min(space.width / natural.width, space.height / natural.height)
    : 0;
  const shown = { width: (natural?.width ?? 0) * fit, height: (natural?.height ?? 0) * fit };
  const gap = {
    x: shown.width ? Math.min(90, Math.max(5, (MIN_HANDLE_GAP / shown.width) * 100)) : 5,
    y: shown.height ? Math.min(90, Math.max(5, (MIN_HANDLE_GAP / shown.height) * 100)) : 5,
  };
  const changed = (Object.keys(FULL_CROP) as Edge[]).some((edge) => crop[edge] !== FULL_CROP[edge]);
  const box = {
    width: (shown.width * (crop.right - crop.left)) / 100,
    height: (shown.height * (crop.bottom - crop.top)) / 100,
  };

  function pointerPercent(event: PointerEvent) {
    const rect = image.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  }
  function startDrag(handle: Handle, event: PointerEvent<HTMLDivElement>) {
    if (busy || !fit || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    const point = pointerPercent(event);
    // Keep the grab offset so the edge doesn't jump to the pointer.
    const offset: Partial<Crop> = {};
    for (const edge of handle.edges) offset[edge] = (horizontal(edge) ? point.x : point.y) - crop[edge];
    drag.current = { pointer: event.pointerId, edges: handle.edges, offset };
    setDragging(handle.label);
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const point = pointerPercent(event);
    const next: Partial<Crop> = {};
    for (const edge of current.edges)
      next[edge] = (horizontal(edge) ? point.x : point.y) - current.offset[edge]!;
    setCrop((crop) => moveEdges(crop, next, gap));
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(null);
  }
  function nudge(handle: Handle, event: KeyboardEvent<HTMLDivElement>) {
    if (busy) return;
    const axis = { ArrowLeft: "x", ArrowRight: "x", ArrowUp: "y", ArrowDown: "y" }[event.key];
    if (!axis) return;
    const edges = handle.edges.filter((edge) => horizontal(edge) === (axis === "x"));
    if (!edges.length) return;
    event.preventDefault();
    const step = (event.shiftKey ? 10 : 1) * (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1);
    const next: Partial<Crop> = {};
    for (const edge of edges) next[edge] = crop[edge] + step;
    setCrop(moveEdges(crop, next, gap));
  }

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
    <Dialog
      title="Just the receipt"
      kicker="RECEIPT PHOTO"
      closeLabel="Close crop"
      className="receipt-crop-dialog"
      // Closing mid-upload would drop a photo that is already on its way.
      close={() => {
        if (!busy) cancel();
      }}
    >
      <div className="receipt-crop-hint">
        <p>Drag the edges to trim the background.</p>
        {changed && (
          <Button variant="text" disabled={busy} onClick={() => setCrop(FULL_CROP)}>
            <RotateCcw size={15} aria-hidden="true" />
            Reset
          </Button>
        )}
      </div>
      <div ref={frame} className="receipt-crop-frame">
        <div
          className={`receipt-crop-stage${fit ? "" : " is-loading"}${busy ? " is-busy" : ""}`}
          style={fit ? { width: shown.width, height: shown.height } : undefined}
        >
          <img
            ref={image}
            alt="Receipt to crop"
            draggable={false}
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() =>
              setError(
                "This image could not be opened. Choose JPEG, PNG or WebP.",
              )
            }
          />
          {fit > 0 && (
            <>
              <div className="receipt-crop-shade" aria-hidden="true">
                <div
                  className="receipt-crop-box"
                  style={{
                    left: `${crop.left}%`,
                    top: `${crop.top}%`,
                    right: `${100 - crop.right}%`,
                    bottom: `${100 - crop.bottom}%`,
                  }}
                />
              </div>
              {HANDLES.map((handle) => {
                const [edge, second] = handle.edges;
                const [min, max] = edgeRange(crop, edge, gap);
                const x = horizontal(edge) ? crop[edge] : (crop.left + crop.right) / 2;
                const y = second ? crop[second] : horizontal(edge) ? (crop.top + crop.bottom) / 2 : crop[edge];
                // Edge handles span the edge between the corners, so any part of it can be grabbed.
                const edgeLength = horizontal(edge) ? box.height : box.width;
                const length = Math.max(HANDLE_HIT, edgeLength - HANDLE_HIT);
                return (
                  <div
                    key={handle.label}
                    role="slider"
                    tabIndex={0}
                    aria-label={handle.label}
                    aria-valuemin={Math.round(min)}
                    aria-valuemax={Math.round(max)}
                    aria-valuenow={Math.round(crop[edge])}
                    aria-valuetext={
                      second
                        ? `${capitalized(edge)} ${Math.round(crop[edge])}%, ${second} ${Math.round(crop[second])}%`
                        : `${Math.round(crop[edge])}%`
                    }
                    aria-orientation={second ? undefined : horizontal(edge) ? "horizontal" : "vertical"}
                    aria-disabled={busy || undefined}
                    className={`receipt-crop-handle ${handle.className}${dragging === handle.label ? " is-dragging" : ""}${!second && edgeLength < HANDLE_HIT * 3 ? " is-cramped" : ""}`}
                    style={{
                      left: `${x}%`,
                      top: `${y}%`,
                      ...(second ? {} : horizontal(edge) ? { height: length } : { width: length }),
                    }}
                    onPointerDown={(event) => startDrag(handle, event)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onLostPointerCapture={endDrag}
                    onKeyDown={(event) => nudge(handle, event)}
                  />
                );
              })}
            </>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error receipt-crop-error">
          {error}
        </p>
      )}
      <div className="receipt-crop-actions">
        <Button variant="secondary" disabled={busy} onClick={cancel}>
          Choose another
        </Button>
        <Button disabled={busy || !natural} onClick={() => void upload()}>
          {busy ? "Uploading…" : "Use this photo"}
        </Button>
      </div>
    </Dialog>
  );
}
