// PROTOTYPE (throwaway): variant C of the new-bill entry screen. See variants.tsx.
// "Facing pages": both ways to split sit open side by side on one sheet, torn
// along a perforated seam. Neither needs to be chosen first.
import { Camera, PencilLine, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { amountText, parseMoney } from "../../../../shared/money";
import { Button } from "../../../../shared/ui/Button";
import { ReceiptPhoto } from "../../photos/ReceiptPhoto";
import { ScanActions } from "../ScanActions";
import { type EntryProps } from "./variants";
import "./variant-c.css";

export function VariantC({
  draft,
  setFile,
  replace,
  setReplace,
  scan,
  update,
  setStep,
}: EntryProps) {
  const data = draft.data;
  const id = useId();
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState(
    data.mode === "manual" && data.totalCents !== null
      ? amountText(data.totalCents)
      : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const continueWithAmount = () => {
    if (!amount.trim()) {
      update({ mode: "manual" });
      setStep(2);
      return;
    }
    try {
      const totalCents = parseMoney(amount);
      update({ mode: "manual", totalCents });
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enter a valid amount.");
    }
  };

  const takeFile = (file: File | null | undefined) => {
    if (!file) return;
    update({ mode: "items" });
    setFile(file);
  };
  const pickFile = (input: HTMLInputElement) => {
    takeFile(input.files?.[0]);
    input.value = "";
  };

  return (
    <div className="pbc-sheet">
      <section
        className="pbc-page pbc-items"
        aria-labelledby={`${id}-items`}
      >
        <header className="pbc-head">
          <h4 id={`${id}-items`}>Split by item</h4>
          <p className="pbc-promise">Everyone pays for what they took.</p>
        </header>
        <p className="pbc-how">
          Scan a receipt and we read the items for you. People then claim what
          they had.
        </p>
        <input
          ref={cameraInput}
          hidden
          type="file"
          aria-label="Take a receipt photo"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={(e) => pickFile(e.currentTarget)}
        />
        <input
          ref={fileInput}
          hidden
          type="file"
          aria-label="Choose a receipt image"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => pickFile(e.currentTarget)}
        />
        <div
          className={[
            "pbc-scan",
            draft.photo && "pbc-scan-bare",
            dragging && "pbc-dragging",
          ]
            .filter(Boolean)
            .join(" ")}
          role="group"
          aria-label="Add a receipt photo"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file?.type.match(/^image\/(jpeg|png|webp)$/)) takeFile(file);
          }}
        >
          <Button
            variant="primary"
            className="pbc-camera"
            onClick={() => cameraInput.current?.click()}
          >
            <Camera size={20} strokeWidth={1.8} aria-hidden="true" />
            Take a picture
          </Button>
          <Button
            variant={draft.photo ? "secondary" : "primary"}
            className="pbc-choose"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={20} strokeWidth={1.8} aria-hidden="true" />
            {draft.photo ? (
              "Choose another photo"
            ) : (
              <>
                <span className="pbc-wide">Choose receipt photo</span>
                <span className="pbc-narrow">Choose photo</span>
              </>
            )}
          </Button>
          {!draft.photo && (
            <span className="pbc-drop-hint">or drop it here</span>
          )}
        </div>
        {draft.photo && (
          <div className="pbc-photo">
            <ReceiptPhoto
              id={draft.id}
              version={draft.revision}
              localPhoto={draft.pendingPhoto}
              expired={draft.photo.expired}
            />
          </div>
        )}
        {draft.photo && !draft.photo.expired && (
          <div className="pbc-scan-actions">
            <ScanActions
              hasItems={data.items.length > 0}
              replace={replace}
              setReplace={setReplace}
              scan={scan}
            />
          </div>
        )}
        <div className="pbc-foot">
          <Button
            variant="text"
            className="pbc-type"
            onClick={() => {
              update({ mode: "items" });
              setStep(1);
            }}
          >
            <PencilLine size={17} aria-hidden="true" />
            No receipt? Type items yourself
          </Button>
        </div>
      </section>

      <div className="pbc-seam" aria-hidden="true">
        <span>or</span>
      </div>

      <section
        className="pbc-page pbc-amount"
        aria-labelledby={`${id}-amount`}
      >
        <header className="pbc-head">
          <h4 id={`${id}-amount`}>Split an amount</h4>
          <p className="pbc-promise">One total, divided.</p>
        </header>
        <p className="pbc-how">
          Enter what was paid. Next you choose who&rsquo;s in, and each
          person enters their own share.
        </p>
        {/* The wizard is already one form, so Enter is handled here. */}
        <div className="pbc-tape-form">
          <div className="pbc-tape">
            <label htmlFor={`${id}-total`}>Total</label>
            <span className="pbc-leader" aria-hidden="true" />
            <span className="pbc-figure">
              <span className="pbc-currency" aria-hidden="true">
                $
              </span>
              <input
                id={`${id}-total`}
                className="pbc-input"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amount}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${id}-total-note`}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  continueWithAmount();
                }}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(null);
                }}
                onBlur={() => {
                  if (!amount.trim()) return;
                  try {
                    setAmount(amountText(parseMoney(amount)));
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Enter a valid amount.",
                    );
                  }
                }}
              />
            </span>
          </div>
          <p
            id={`${id}-total-note`}
            className={error ? "pbc-note pbc-note-error" : "pbc-note"}
          >
            {error ?? "In CAD, with tax and tip. You can leave it for the next step."}
          </p>
          <div className="pbc-foot">
            <Button
              variant="primary"
              className="pbc-continue"
              onClick={continueWithAmount}
            >
              Continue to people
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
