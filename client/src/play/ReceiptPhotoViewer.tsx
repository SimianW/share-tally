import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import Dialog from "./Dialog";
import { Button } from "./ui";

let viewerHistoryId = 0;

export type ReceiptViewerImage = { url: string; width: number; height: number };

export function ReceiptPhotoViewer({ image, points, subject, close }: {
  image: ReceiptViewerImage;
  points?: string;
  subject?: string;
  close: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const zoom = useRef<ReactZoomPanPinchRef>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);

  // This entry keeps the hash unchanged, so route subscribers and draft blockers
  // see no navigation. Back consumes only the viewer entry.
  const entry = useRef<number | null>(null);
  const cleanupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef(false);
  const requestClose = () => {
    if (closing.current) return;
    closing.current = true;
    if (window.history.state?.receiptViewer === entry.current) window.history.back();
    else closeRef.current();
  };
  useEffect(() => {
    if (cleanupTimer.current) clearTimeout(cleanupTimer.current);
    if (entry.current === null) entry.current = ++viewerHistoryId;
    const id = entry.current;
    // An earlier viewer's entry may not have been retired yet; reuse it instead
    // of stacking a second one behind this viewer.
    const current = window.history.state?.receiptViewer;
    if (current === undefined) window.history.pushState({ receiptViewer: id }, "", window.location.href);
    else if (current !== id) window.history.replaceState({ receiptViewer: id }, "", window.location.href);
    let active = true;
    const onBack = () => {
      if (!active || window.history.state?.receiptViewer === id) return;
      active = false;
      closeRef.current();
    };
    window.addEventListener("popstate", onBack);
    return () => {
      window.removeEventListener("popstate", onBack);
      // requestClose may already be going back; a second back would leave the bill.
      if (active && !closing.current) cleanupTimer.current = setTimeout(() => {
        if (window.history.state?.receiptViewer === id) window.history.back();
      }, 0);
    };
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  const fit = Math.min(size.width / image.width, size.height / image.height);
  const maxScale = Math.max(4, 2 / fit);
  return <Dialog title={subject ? `Receipt photo · ${subject}` : "Receipt photo"} kicker="SOURCE RECEIPT" className="receipt-photo-viewer" closeLabel="Close photo" close={requestClose}>
    <div className="receipt-photo-tools">
      <button type="button" className="button secondary" aria-label="Zoom out" disabled={scale <= 1} onClick={() => void zoom.current?.zoomOut(0.5)}><ZoomOut size={18} /></button>
      <output aria-label="Photo zoom">{Math.round(scale * 100)}%</output>
      <button type="button" className="button secondary" aria-label="Zoom in" disabled={scale >= maxScale} onClick={() => void zoom.current?.zoomIn(0.5)}><ZoomIn size={18} /></button>
      <Button variant="text" onClick={() => void zoom.current?.setTransform((size.width - image.width * fit) / 2, (size.height - image.height * fit) / 2, 1, 0)}>Fit photo</Button>
    </div>
    <div ref={viewport} className="receipt-photo-viewport" aria-label="Zoomed receipt photo">
      {fit > 0 && Number.isFinite(fit) && <TransformWrapper key={`${size.width}:${size.height}`} ref={zoom} initialScale={1} minScale={1} maxScale={maxScale} centerOnInit limitToBounds onInit={() => setScale(1)} onTransform={(_, state) => setScale(state.scale)} wheel={{ step: 0.12 }} doubleClick={{ mode: "zoomIn", step: 1 }} keyboard={{ disabled: false, panStep: 60 }}>
        <TransformComponent wrapperClass="receipt-photo-transform" contentClass="receipt-photo-content"
          wrapperProps={{ role: "group", "aria-label": "Receipt photo. Arrow keys pan; plus and minus zoom." }}>
          <svg role="img" aria-label="Full-size original receipt" width={image.width * fit} height={image.height * fit} viewBox={`0 0 ${image.width} ${image.height}`}>
            <image href={image.url} width={image.width} height={image.height} />
            {/* The zoom is a CSS transform outside the SVG, which non-scaling-stroke does not undo. */}
            {points && <polygon role="img" aria-label="Highlighted receipt line" points={points} style={{ strokeWidth: 2 / scale }} />}
          </svg>
        </TransformComponent>
      </TransformWrapper>}
    </div>
  </Dialog>;
}
