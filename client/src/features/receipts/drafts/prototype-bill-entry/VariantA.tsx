// PROTOTYPE (throwaway): variant A of the new-bill entry screen. See variants.tsx.
// "Two doors": pick how to split first. The item door opens in place to show
// how to get the items (scan a receipt or type them); the total door goes
// straight to People.
import { ArrowRight, Camera, ChevronDown, PencilLine, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "../../../../shared/ui/Button";
import { ReceiptPhoto } from "../../photos/ReceiptPhoto";
import { ScanActions } from "../ScanActions";
import { type EntryProps } from "./variants";
import "./variant-a.css";

/** Morph between the closed and open layouts where the browser can. */
function transition(change: () => void) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !document.startViewTransition) {
    change();
    return;
  }
  document.startViewTransition(() => flushSync(change));
}

export function VariantA({
  draft,
  setFile,
  replace,
  setReplace,
  scan,
  update,
  setStep,
}: EntryProps) {
  const [open, setOpen] = useState(Boolean(draft.photo));
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const panelId = `${id}-panel`;
  const photo = draft.photo;

  const pick = (input: HTMLInputElement) => {
    setFile(input.files?.[0] ?? null);
    input.value = "";
  };

  return (
    <div className={`pba-doors${open ? " pba-open" : ""}`}>
      <section
        className="pba-door pba-door-items"
        aria-labelledby={`${id}-items`}
      >
        <div className="pba-face">
          <ItemsPicture />
          <div className="pba-words">
            <h4>
              <button
                type="button"
                id={`${id}-items`}
                className="pba-door-button"
                aria-expanded={open}
                aria-controls={panelId}
                aria-describedby={`${id}-items-says`}
                onClick={() => {
                  if (!open) update({ mode: "items" });
                  transition(() => setOpen(!open));
                }}
              >
                Split by item
                <ChevronDown className="pba-door-icon" size={20} aria-hidden="true" />
              </button>
            </h4>
            <p id={`${id}-items-says`}>
              List what was bought. Everyone claims what they had and pays for
              that.
            </p>
          </div>
        </div>

        <div className="pba-inside" id={panelId} hidden={!open}>
          <div className="pba-way">
            <h5>{photo ? "Your receipt" : "Scan a receipt"}</h5>
            <p>
              {photo
                ? "Read it to fill in the items, or pick a different photo."
                : "Crop the photo and we read the items for you. You check them next."}
            </p>
            <input
              ref={cameraInput}
              hidden
              type="file"
              aria-label="Take a receipt photo"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => pick(e.currentTarget)}
            />
            <input
              ref={fileInput}
              hidden
              type="file"
              aria-label="Choose a receipt image"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => pick(e.currentTarget)}
            />
            {photo && (
              <ReceiptPhoto
                id={draft.id}
                version={draft.revision}
                localPhoto={draft.pendingPhoto}
                expired={photo.expired}
              />
            )}
            {photo && !photo.expired && (
              <ScanActions
                hasItems={draft.data.items.length > 0}
                replace={replace}
                setReplace={setReplace}
                scan={scan}
              />
            )}
            <div
              className="pba-upload"
              role="group"
              aria-label="Add a receipt photo"
            >
              <Button
                variant={photo ? "secondary" : "primary"}
                className="pba-camera"
                onClick={() => cameraInput.current?.click()}
              >
                <Camera size={20} strokeWidth={1.8} aria-hidden="true" />
                {photo ? "Take another" : "Take a picture"}
              </Button>
              <Button
                variant={photo ? "secondary" : "primary"}
                className="pba-file"
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={20} strokeWidth={1.8} aria-hidden="true" />
                {photo ? "Choose another file" : "Choose file"}
              </Button>
            </div>
          </div>
          <div className="pba-way">
            <h5>Type the items</h5>
            <p>No receipt handy? Add each item and its price.</p>
            <Button
              variant="secondary"
              onClick={() => {
                update({ mode: "items" });
                setStep(1);
              }}
            >
              <PencilLine size={18} aria-hidden="true" /> Type items
            </Button>
          </div>
        </div>
      </section>

      <section
        className="pba-door pba-door-total"
        aria-labelledby={`${id}-total`}
      >
        <div className="pba-face">
          <TotalPicture />
          <div className="pba-words">
            <h4>
              <button
                type="button"
                id={`${id}-total`}
                className="pba-door-button"
                aria-describedby={`${id}-total-says`}
                onClick={() => {
                  update({ mode: "manual" });
                  setStep(2);
                }}
              >
                {open ? "Split a total instead" : "Split a total"}
                <ArrowRight className="pba-door-icon" size={20} aria-hidden="true" />
              </button>
            </h4>
            <p id={`${id}-total-says`}>
              Enter one amount and divide it between people. No items needed.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/** A torn-off receipt whose lines carry the colors of whoever claimed them. */
function ItemsPicture() {
  const rows: { name: string; price: string; who: number[] }[] = [
    { name: "Oat milk", price: "4.29", who: [1] },
    { name: "Sourdough", price: "6.50", who: [2] },
    { name: "Coffee beans", price: "18.99", who: [1, 3] },
    { name: "Berries", price: "7.49", who: [3] },
  ];
  return (
    <div className="pba-picture" aria-hidden="true">
      <div className="pba-receipt">
        {rows.map((row) => (
          <div className="pba-receipt-row" key={row.name}>
            <span className="pba-receipt-name">{row.name}</span>
            <span className="pba-receipt-price">{row.price}</span>
            <span className="pba-claims">
              {row.who.map((n) => (
                <i key={n} className={`pba-dot pba-who-${n}`}>
                  {"ABC"[n - 1]}
                </i>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One amount cut into equal shares, one per person. */
function TotalPicture() {
  return (
    <div className="pba-picture" aria-hidden="true">
      <div className="pba-total">
        <span className="pba-total-amount">$84.00</span>
        <div className="pba-shares">
          {[1, 2, 3].map((n) => (
            <span key={n} className="pba-share">
              <i className={`pba-dot pba-who-${n}`}>{"ABC"[n - 1]}</i>
              $28.00
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
