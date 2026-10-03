import { type ReceiptData } from "@share-tally/domain/contracts/receipts";
import { ArrowRight } from "lucide-react";
import { useId, useRef, useState } from "react";
import { amountText, parseMoney } from "../../../shared/money";
import { Button } from "../../../shared/ui/Button";
import { type Step } from "./draft-model";

/** Cents for a valid, positive total, or the message explaining why it is not. */
function parseTotal(text: string): number | string {
  if (!text.trim()) return "Enter the total to split.";
  try {
    const cents = parseMoney(text);
    return cents > 0 ? cents : "Enter an amount above $0.00.";
  } catch (error) {
    return error instanceof Error ? error.message : "Enter a valid amount.";
  }
}

/**
 * By amount: the total is entered here, then People picks who shares it. A valid
 * typed total is draft content at once, so saving, leaving and recovery keep it;
 * an invalid one leaves the draft without a total.
 */
export function SplitTotalPanel({ mode, text, setText, update, setStep }: {
  mode: ReceiptData["mode"];
  /** The typed total, kept by the step while the other panel shows. */
  text: string;
  setText: (text: string) => void;
  update: (patch: Partial<ReceiptData>) => void;
  setStep: (step: Step) => void;
}) {
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const proceed = () => {
    const total = parseTotal(text);
    if (typeof total === "string") {
      setError(total);
      input.current?.focus();
      return;
    }
    update({ mode: "manual", totalCents: total });
    setStep(2);
  };
  return (
    <section aria-label="Split by amount">
      <p className="split-method-outcome">
        One total, divided among the people you pick next.
      </p>
      <div className={error ? "split-total split-total-invalid" : "split-total"}>
        <label htmlFor={inputId}>Total to split</label>
        <div className="split-total-row">
          <span className="split-total-symbol" aria-hidden="true">$</span>
          <input
            ref={input}
            id={inputId}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            onChange={(e) => {
              const typed = e.target.value;
              const total = parseTotal(typed);
              const cents = typeof total === "number" ? total : null;
              setText(typed);
              setError("");
              // An invalid total clears a By amount draft's total, so People
              // never opens with a stale one.
              if (cents !== null) update({ mode: "manual", totalCents: cents });
              else if (mode === "manual") update({ totalCents: null });
            }}
            onBlur={() => {
              const total = parseTotal(text);
              if (typeof total === "number") setText(amountText(total));
            }}
            // Enter would otherwise submit the bill form. An input method
            // uses Enter to confirm a composition, which is not a request to continue.
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              proceed();
            }}
          />
          <span className="split-total-currency">CAD</span>
        </div>
      </div>
      <p id={errorId} className="split-total-error" aria-live="polite">{error}</p>
      <div className="split-total-actions">
        <p>Next, choose who’s in and whether it splits evenly.</p>
        <Button onClick={proceed}>
          Continue to people <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
