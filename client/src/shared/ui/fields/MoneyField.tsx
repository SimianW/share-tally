import { amountText } from '../../money';
import { useState } from "react";
import { parseMoney } from "../../money";
export function MoneyField({
  label,
  value,
  change,
  signed = false,
  emptyAsZero = false,
  required = !emptyAsZero,
  autoFocus = false,
}: {
  label: string;
  value: number | null;
  change: (n: number | null) => void;
  signed?: boolean;
  emptyAsZero?: boolean;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [input, setInput] = useState({
    value,
    text: value === null ? "" : amountText(value),
  });
  const text =
    input.value === value
      ? input.text
      : value === null
        ? ""
        : amountText(value);
  return (
    <label>
      {label}
      <input
        required={required}
        aria-label={label}
        autoFocus={autoFocus}
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
