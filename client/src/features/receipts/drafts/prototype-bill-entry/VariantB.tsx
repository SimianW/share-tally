// PROTOTYPE (throwaway): variant B of the new-bill entry screen. See variants.tsx.
// A two-way mode switch states the methods as peers; one complete panel shows at a time.
import {
  ArrowRight,
  Camera,
  Divide,
  ListChecks,
  PencilLine,
  ReceiptText,
  Upload,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { amountText, parseMoney } from "../../../../shared/money";
import { Button } from "../../../../shared/ui/Button";
import { ReceiptPhoto } from "../../photos/ReceiptPhoto";
import { ScanActions } from "../ScanActions";
import { type EntryProps } from "./variants";
import "./variant-b.css";

type Mode = "items" | "amount";

const modes: readonly { value: Mode; label: string; Icon: typeof Divide }[] = [
  { value: "items", label: "By item", Icon: ListChecks },
  { value: "amount", label: "By amount", Icon: Divide },
];

export function VariantB(props: EntryProps) {
  const [mode, setMode] = useState<Mode>(
    props.draft.data.mode === "manual" ? "amount" : "items",
  );
  const name = useId();
  const panelId = useId();
  return (
    <div className="pbb">
      <div
        role="radiogroup"
        aria-label="How to split this bill"
        className="pbb-switch"
        data-mode={mode}
      >
        <span className="pbb-switch-thumb" aria-hidden="true" />
        {modes.map(({ value, label, Icon }) => (
          <label key={value} className="pbb-switch-option">
            <input
              type="radio"
              name={name}
              value={value}
              checked={mode === value}
              aria-controls={panelId}
              onChange={() => setMode(value)}
            />
            <Icon size={20} strokeWidth={2} aria-hidden="true" />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div id={panelId} className="pbb-stage">
        {mode === "items" ? (
          <ItemPanel key="items" {...props} />
        ) : (
          <AmountPanel key="amount" {...props} />
        )}
      </div>
    </div>
  );
}

function ItemPanel({
  draft,
  setFile,
  replace,
  setReplace,
  scan,
  update,
  setStep,
}: EntryProps) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pick = (input: HTMLInputElement) => {
    setFile(input.files?.[0] ?? null);
    input.value = "";
  };
  return (
    <section className="pbb-panel pbb-panel-items" aria-label="Split by item">
      <p className="pbb-outcome">
        Everyone claims what they had and pays for their own items.
      </p>
      <div className="pbb-receipt">
        <ReceiptText
          className="pbb-receipt-icon"
          size={28}
          strokeWidth={1.8}
          aria-hidden="true"
        />
        <div className="pbb-receipt-copy">
          <h4>{draft.photo ? "Your receipt" : "Scan a receipt"}</h4>
          <p>Take or choose a photo, crop it, and the items are read for you.</p>
        </div>
        <div
          className="pbb-receipt-buttons"
          role="group"
          aria-label="Add a receipt photo"
        >
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
          <Button
            className="pbb-camera-button"
            onClick={() => cameraInput.current?.click()}
          >
            <Camera size={20} strokeWidth={1.8} aria-hidden="true" />
            Take a picture
          </Button>
          <Button
            variant="secondary"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={20} strokeWidth={1.8} aria-hidden="true" />
            Choose a photo
          </Button>
        </div>
        {draft.photo && (
          <div className="pbb-receipt-photo">
            <ReceiptPhoto
              id={draft.id}
              version={draft.revision}
              localPhoto={draft.pendingPhoto}
              expired={draft.photo.expired}
            />
          </div>
        )}
        {draft.photo && !draft.photo.expired && (
          <ScanActions
            hasItems={draft.data.items.length > 0}
            replace={replace}
            setReplace={setReplace}
            scan={scan}
          />
        )}
      </div>
      <div className="pbb-type-items">
        <span>No receipt to hand?</span>
        <Button
          variant="text"
          onClick={() => {
            update({ mode: "items" });
            setStep(1);
          }}
        >
          <PencilLine size={17} aria-hidden="true" /> Type the items in
        </Button>
      </div>
    </section>
  );
}

function AmountPanel({ draft, update, setStep }: EntryProps) {
  const start = draft.data.mode === "manual" ? draft.data.totalCents : null;
  const [text, setText] = useState(start === null ? "" : amountText(start));
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const parse = (value: string): number | string => {
    if (!value.trim()) return "Enter the total to split.";
    try {
      const cents = parseMoney(value);
      return cents > 0 ? cents : "Enter an amount above $0.00.";
    } catch (e) {
      return e instanceof Error ? e.message : "Enter a valid amount.";
    }
  };
  const proceed = () => {
    const result = parse(text);
    if (typeof result === "string") {
      setError(result);
      document.getElementById(inputId)?.focus();
      return;
    }
    update({ mode: "manual", totalCents: result });
    setStep(2);
  };
  return (
    <section className="pbb-panel pbb-panel-amount" aria-label="Split by amount">
      <p className="pbb-outcome">
        One total, divided among the people you pick next.
      </p>
      <div className={`pbb-amount${error ? " pbb-amount-invalid" : ""}`}>
        <label htmlFor={inputId} className="pbb-amount-label">
          Total to split
        </label>
        <div className="pbb-amount-row">
          <span className="pbb-amount-symbol" aria-hidden="true">
            $
          </span>
          <input
            id={inputId}
            className="pbb-amount-input"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            onBlur={() => {
              const result = parse(text);
              if (typeof result === "number") setText(amountText(result));
            }}
            // Enter would otherwise submit the wizard form, which shares the bill.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                proceed();
              }
            }}
          />
          <span className="pbb-amount-currency">CAD</span>
        </div>
      </div>
      <p id={errorId} className="pbb-amount-error" aria-live="polite">
        {error}
      </p>
      <div className="pbb-amount-actions">
        <p>Next, choose who’s in and whether it splits evenly.</p>
        <Button onClick={proceed}>
          Continue to people <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
