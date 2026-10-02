import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "../../../shared/ui/Button";
import { RotateCcw } from "lucide-react";
import Dialog from "../../../shared/ui/Dialog";

type Crop = { left: number; top: number; right: number; bottom: number };
type Edge = keyof Crop;
type Handle = {
  edges: readonly Edge[];
  label: string;
  className: string;
};
type Gap = { x: number; y: number };
const FULL_CROP: Crop = { left: 0, top: 0, right: 100, bottom: 100 };
// The one source for the handle hit area; the stylesheet reads it as --crop-hit.
// Opposite edges stay one hit area plus a little air apart on screen, so
// opposing targets never overlap.
const HANDLE_HIT = 44;
const MIN_HANDLE_GAP = HANDLE_HIT + 4;
// A midpoint target needs a full hit area of edge between the two corner targets.
const MIDPOINT_ROOM = HANDLE_HIT * 2;
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
/** Minimum crop size per axis, in percent of the photo as currently displayed. */
function minimumGap(shown: { width: number; height: number }): Gap {
  // A photo displayed thinner than the gap can't be trimmed on that axis
  // without opposite targets overlapping, so that axis stays full (100%).
  const axis = (size: number) =>
    size >= MIN_HANDLE_GAP ? Math.max(5, (MIN_HANDLE_GAP / size) * 100) : 100;
  return { x: axis(shown.width), y: axis(shown.height) };
}
/** Widens any axis narrower than the gap around its centre, staying on the photo. */
function reconcile(crop: Crop, gap: Gap): Crop {
  const axis = (start: number, end: number, size: number) => {
    if (end - start >= size) return [start, end];
    const from = Math.min(Math.max((start + end) / 2 - size / 2, 0), 100 - size);
    return [from, from + size];
  };
  const [left, right] = axis(crop.left, crop.right, gap.x);
  const [top, bottom] = axis(crop.top, crop.bottom, gap.y);
  return { left, top, right, bottom };
}
/** Moves the given edges, keeping them on the photo and apart from their opposite edge. */
function moveEdges(crop: Crop, next: Partial<Crop>, gap: Gap): Crop {
  const result = { ...crop };
  for (const edge of Object.keys(next) as Edge[]) {
    const [min, max] = edgeRange(crop, edge, gap);
    result[edge] = Math.min(Math.max(next[edge]!, min), max);
  }
  return result;
}
function edgeRange(crop: Crop, edge: Edge, gap: Gap) {
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
  // The stored crop is reconciled with the current minimum on every render, so
  // a resize that raises the minimum never leaves an invalid crop on screen,
  // in the ARIA values or in the upload.
  const [storedCrop, setCrop] = useState<Crop>(FULL_CROP);
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
  const gap = fit ? minimumGap(shown) : { x: 5, y: 5 };
  const crop = reconcile(storedCrop, gap);
  const changed = (Object.keys(FULL_CROP) as Edge[]).some((edge) => crop[edge] !== FULL_CROP[edge]);
  const box = {
    width: (shown.width * (crop.right - crop.left)) / 100,
    height: (shown.height * (crop.bottom - crop.top)) / 100,
  };

  const cornersActive = gap.x < 100 && gap.y < 100;

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
    setCrop((stored) => moveEdges(reconcile(stored, gap), next, gap));
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
          style={{
            "--crop-hit": `${HANDLE_HIT}px`,
            ...(fit ? { width: shown.width, height: shown.height } : {}),
          } as CSSProperties}
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
                // Rounding can put a value half a percent past its bound; clamp so min ≤ now ≤ max.
                const low = Math.round(min);
                const high = Math.max(low, Math.round(max));
                const now = Math.min(Math.max(Math.round(crop[edge]), low), high);
                const x = horizontal(edge) ? crop[edge] : (crop.left + crop.right) / 2;
                const y = second ? crop[second] : horizontal(edge) ? (crop.top + crop.bottom) / 2 : crop[edge];
                // Edge handles span the edge between the corners, so any part of it can be grabbed.
                const edgeLength = horizontal(edge) ? box.height : box.width;
                const length = Math.max(HANDLE_HIT, edgeLength - HANDLE_HIT);
                // Pointer targets never overlap; a handle that can't have its own
                // target leaves pointer hit-testing but stays focusable. Corners do
                // so when either axis is too thin to trim, since they would then
                // cover each other. A midpoint does so when its own axis can't be
                // trimmed, or when its edge is too short to fit between the corners.
                const passive = second
                  ? !cornersActive
                  : (horizontal(edge) ? gap.x : gap.y) >= 100 || (cornersActive && edgeLength < MIDPOINT_ROOM);
                return (
                  <div
                    key={handle.label}
                    role="slider"
                    tabIndex={0}
                    aria-label={handle.label}
                    aria-valuemin={low}
                    aria-valuemax={high}
                    aria-valuenow={now}
                    aria-valuetext={
                      second
                        ? `${capitalized(edge)} ${now}%, ${second} ${Math.round(crop[second])}%`
                        : `${now}%`
                    }
                    aria-orientation={second ? undefined : horizontal(edge) ? "horizontal" : "vertical"}
                    aria-disabled={busy || undefined}
                    className={`receipt-crop-handle ${handle.className}${dragging === handle.label ? " is-dragging" : ""}${passive ? " is-passive" : ""}`}
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
