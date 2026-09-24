import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Item, ReceiptSummary } from "./mock-data";
import { money } from "./mock-data";

export type ReceiptImageProps = {
  items: Item[];
  highlight?: string;
  mode?: "strip" | "photo" | "crop";
  summary?: ReceiptSummary;
};

const receiptWidth = 420;
const topY = 202;
const rowHeight = 30;
const bottomPadding = 210;

function lineY(lineIndex: number) {
  return topY + lineIndex * rowHeight;
}

function ReceiptSvg({
  items,
  highlight,
  summary,
  idPrefix,
}: {
  items: Item[];
  highlight?: string;
  summary?: ReceiptSummary;
  idPrefix: string;
}) {
  const lineCount = items.reduce((maximum, item) => Math.max(maximum, item.lineIndex + 1), 0);
  const height = topY + lineCount * rowHeight + bottomPadding;
  const itemDiscountCents = items.reduce((sum, item) => sum + item.discountCents, 0);
  const summaryY = topY + lineCount * rowHeight + 6;
  return (
    <svg
      viewBox={`0 0 ${receiptWidth} ${height}`}
      role="img"
      aria-label="Illustrated Costco Canada receipt"
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      <defs>
        <filter id={`${idPrefix}-shadow`} x="-20%" y="-5%" width="140%" height="115%">
          <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor="#342f27" floodOpacity=".18" />
        </filter>
      </defs>
      <rect x="18" y="8" width="384" height={height - 16} rx="4" fill="#fffdf7" filter={`url(#${idPrefix}-shadow)`} />
      <text x="210" y="52" textAnchor="middle" fill="#12579a" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="28" letterSpacing="-1">COSTCO</text>
      <text x="210" y="74" textAnchor="middle" fill="#333" fontFamily="monospace" fontSize="11">WHOLESALE CANADA LTD.</text>
      <text x="210" y="92" textAnchor="middle" fill="#555" fontFamily="monospace" fontSize="10">#560 - VANCOUVER, BC</text>
      <text x="210" y="120" textAnchor="middle" fill="#333" fontFamily="monospace" fontSize="10">MEMBER  1000 0042 1234</text>
      <text x="210" y="139" textAnchor="middle" fill="#333" fontFamily="monospace" fontSize="10">2025-05-18  14:32</text>
      <line x1="40" x2="380" y1="158" y2="158" stroke="#777" strokeDasharray="2 3" />
      <text x="40" y="181" fill="#555" fontFamily="monospace" fontSize="9">ITEM</text>
      <text x="378" y="181" textAnchor="end" fill="#555" fontFamily="monospace" fontSize="9">PRICE</text>
      {items.map((item) => {
        const y = lineY(item.lineIndex);
        const active = highlight === item.id;
        return (
          <g key={item.id} data-receipt-item={item.id}>
            {active && <rect x="31" y={y - 17} width="358" height="25" rx="3" fill="#ffd76a" fillOpacity=".55" stroke="#c77722" strokeWidth="1.5" />}
            <text x="39" y={y} fill="#302d29" fontFamily="monospace" fontWeight={active ? 700 : 400} fontSize="9.5">
              {item.originalText.slice(0, 44)}
            </text>
            <text x="379" y={y} textAnchor="end" fill={item.printedCents === null ? "#a4472f" : "#302d29"} fontFamily="monospace" fontSize="10.4">
              {item.printedCents === null ? "?.??" : (item.printedCents / 100).toFixed(2)}
            </text>
          </g>
        );
      })}
      <line x1="40" x2="380" y1={summaryY} y2={summaryY} stroke="#777" strokeDasharray="2 3" />
      {summary && (
        <g fill="#333" fontFamily="monospace" fontSize="10">
          <text x="42" y={summaryY + 20}>GROSS</text><text x="378" y={summaryY + 20} textAnchor="end">{money(summary.subtotalCents + itemDiscountCents + summary.discountCents)}</text>
          <text x="42" y={summaryY + 39}>ITEM SAVINGS</text><text x="378" y={summaryY + 39} textAnchor="end">-{money(itemDiscountCents)}</text>
          <text x="42" y={summaryY + 58} fontWeight="700">SUBTOTAL</text><text x="378" y={summaryY + 58} textAnchor="end" fontWeight="700">{money(summary.subtotalCents)}</text>
          <text x="42" y={summaryY + 77}>RECEIPT DISCOUNT</text><text x="378" y={summaryY + 77} textAnchor="end">-{money(summary.discountCents)}</text>
          <text x="42" y={summaryY + 96}>HST (13%)</text><text x="378" y={summaryY + 96} textAnchor="end">{money(summary.taxCents)}</text>
          <text x="42" y={summaryY + 115}>ECO FEE</text><text x="378" y={summaryY + 115} textAnchor="end">{money(summary.otherCents)}</text>
          <text x="42" y={summaryY + 141} fontWeight="700">TOTAL</text><text x="378" y={summaryY + 141} textAnchor="end" fontWeight="700">{money(summary.totalCents)}</text>
        </g>
      )}
      <text x="210" y={height - 20} textAnchor="middle" fill="#666" fontFamily="monospace" fontSize="9">THANK YOU FOR SHOPPING AT COSTCO</text>
    </svg>
  );
}

export default function ReceiptImage({
  items,
  highlight,
  mode = "strip",
  summary,
}: ReceiptImageProps) {
  const [zoomed, setZoomed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(420);
  const photoScroller = useRef<HTMLDivElement>(null);
  const cropScroller = useRef<HTMLDivElement>(null);
  const zoomScroller = useRef<HTMLDivElement>(null);
  const isThumbnail = mode === "strip";
  const isCrop = mode === "crop";
  const cropViewportHeight = isThumbnail ? 132 : isCrop ? 108 : 380;
  const selectedItem = items.find((item) => item.id === highlight);
  const currentLineY = selectedItem ? lineY(selectedItem.lineIndex) : topY;
  const fullImageWidth = isThumbnail ? Math.round(viewportWidth * 1.08) : viewportWidth;
  const cropOffset = Math.round(
    cropViewportHeight / 2 - currentLineY * (fullImageWidth / receiptWidth),
  );

  useEffect(() => {
    const element = cropScroller.current;
    if (!element) return;
    const update = () => setViewportWidth(Math.min(element.clientWidth - 12, 560));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode]);

  useEffect(() => {
    if (!highlight || (mode === "strip" && !zoomed)) return;
    for (const scroller of [photoScroller.current, zoomScroller.current]) {
      const line = scroller?.querySelector<SVGGElement>(`[data-receipt-item="${CSS.escape(highlight)}"]`);
      if (!scroller || !line) continue;
      // Scroll only the photo, never the page, so the list the user is scrolling stays put.
      const lineRect = line.getBoundingClientRect(), box = scroller.getBoundingClientRect();
      scroller.scrollBy({ top: lineRect.top - box.top - box.height / 2 + lineRect.height / 2, behavior: "smooth" });
    }
  }, [highlight, zoomed, mode]);

  const summaryForImage = summary;
  const photoStyle: CSSProperties = isThumbnail
    ? { width: "100%", height: cropViewportHeight, overflow: "hidden", position: "relative", borderRadius: 12, background: "#edeae3", touchAction: "pan-x pan-y pinch-zoom" }
    : isCrop
      ? { width: "100%", height: cropViewportHeight, overflow: "hidden", position: "relative", borderRadius: 14, background: "#edeae3", touchAction: "pan-x pan-y pinch-zoom" }
      : { width: "100%", height: "min(76vh, 820px)", overflow: "auto", borderRadius: 14, background: "#edeae3", overscrollBehavior: "contain", touchAction: "pan-x pan-y pinch-zoom" };

  const showReceipt = (id: string) => (
    <ReceiptSvg items={items} highlight={highlight} summary={summaryForImage} idPrefix={id} />
  );

  return (
    <>
      <div style={{ position: "relative" }}>
      <div style={photoStyle} ref={isThumbnail || isCrop ? cropScroller : photoScroller} aria-label="Receipt image">
        {isThumbnail || isCrop ? (
          <button type="button" onClick={() => { setZoom(1); setZoomed(true); }} aria-label="Open highlighted receipt line in full-screen photo" style={{ position: "absolute", top: cropOffset, left: "50%", width: fullImageWidth, maxWidth: "none", border: 0, padding: 0, background: "transparent", cursor: "zoom-in", transition: "top .28s ease", transform: "translateX(-50%) rotate(-0.6deg)", transformOrigin: "top center", filter: "drop-shadow(0 4px 8px rgba(52,47,39,.2))" }}>
            {showReceipt("receipt-inline")}
          </button>
        ) : (
          <button type="button" onClick={() => { setZoom(1); setZoomed(true); }} aria-label="Open receipt photo in full screen" style={{ display: "block", width: "min(100%, 560px)", margin: "0 auto", border: 0, padding: 18, background: "transparent", cursor: "zoom-in", transform: "rotate(-0.6deg)", transformOrigin: "top center" }}>
            {showReceipt("receipt-inline")}
          </button>
        )}
        {!isCrop && <span aria-hidden="true" style={{ position: "absolute", right: 9, bottom: 9, zIndex: 1, borderRadius: 999, padding: "8px 11px", background: "#292722", color: "white", font: "600 12px system-ui", pointerEvents: "none" }}>
          ⤢ Zoom
        </span>}
      </div>
      </div>
      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Full-screen receipt photo"
          onClick={(event) => { if (event.target === event.currentTarget) setZoomed(false); }}
          onKeyDown={(event) => { if (event.key === "Escape") setZoomed(false); }}
          tabIndex={-1}
          style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", gridTemplateRows: "auto 1fr", padding: "14px clamp(10px, 3vw, 36px)", background: "rgba(25, 24, 22, .94)", color: "white" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, maxWidth: 760, width: "100%", margin: "0 auto 10px" }}>
            <strong style={{ font: "600 14px system-ui" }}>Receipt photo</strong>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => setZoom((value) => Math.max(0.65, value - 0.2))} aria-label="Zoom out" style={{ border: "1px solid #777", borderRadius: 999, padding: "7px 11px", color: "white", background: "#34322e", cursor: "pointer" }}>−</button>
              <button type="button" onClick={() => setZoom((value) => Math.min(2.4, value + 0.2))} aria-label="Zoom in" style={{ border: "1px solid #777", borderRadius: 999, padding: "7px 11px", color: "white", background: "#34322e", cursor: "pointer" }}>+</button>
              <button type="button" onClick={() => setZoomed(false)} aria-label="Close receipt photo" style={{ border: "1px solid #777", borderRadius: 999, padding: "7px 13px", color: "white", background: "#34322e", cursor: "pointer" }}>Close ×</button>
            </div>
          </div>
          <div ref={zoomScroller} style={{ overflow: "auto", width: "100%", maxWidth: 760, margin: "0 auto", borderRadius: 14, background: "#edeae3", overscrollBehavior: "contain", touchAction: "pan-x pan-y pinch-zoom" }}>
            <div style={{ width: `min(${zoom * 100}%, ${zoom * 600}px)`, minWidth: 300, margin: "0 auto", padding: 16, transform: "rotate(-0.6deg)", transformOrigin: "top center" }}>
              {showReceipt("receipt-zoom")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
