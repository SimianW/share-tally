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

/** By amount: the total is entered here, then People picks who shares it. */
export function SplitTotalPanel({ text, setText, update, setStep }: {
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
              setText(e.target.value);
              setError("");
            }}
            onBlur={() => {
              const total = parseTotal(text);
              if (typeof total === "number") setText(amountText(total));
            }}
            // Enter would otherwise submit the bill form.
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
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
