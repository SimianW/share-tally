import { useState } from "react";
import { parseMoney } from "./bill-api";
export function ReceiptAmount({
  label,
  value,
  change,
  signed = false,
  emptyAsZero = false,
  required = !emptyAsZero,
}: {
  label: string;
  value: number | null;
  change: (n: number | null) => void;
  signed?: boolean;
  emptyAsZero?: boolean;
  required?: boolean;
}) {
  const [input, setInput] = useState({
    value,
    text: value === null ? "" : (value / 100).toFixed(2),
  });
  const text =
    input.value === value
      ? input.text
      : value === null
        ? ""
        : (value / 100).toFixed(2);
  return (
    <label>
      {label}
      <input
        required={required}
        aria-label={label}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const text = e.target.value;
          if (!text.trim()) {
            e.target.setCustomValidity("");
            const next = emptyAsZero ? 0 : null;
            setInput({ value: next, text });
            change(next);
            return;
          }
          try {
            const negative = signed && text.startsWith("-");
            const amount = parseMoney(negative ? text.slice(1) : text);
            const next = negative ? -amount : amount;
            e.target.setCustomValidity("");
            setInput({ value: next, text });
            change(next);
          } catch {
            setInput({ value, text });
            e.target.setCustomValidity(
              "Enter a valid CAD amount, with at most two decimals.",
            );
          }
        }}
      />
      {value === null && required && <span className="field-error">Enter an amount.</span>}
    </label>
  );
}
