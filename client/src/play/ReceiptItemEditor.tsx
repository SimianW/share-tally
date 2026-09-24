import { requestId } from "./request-id";
import { useState } from "react";
import { money, parseMoney } from "./bill-api";
import type { ReceiptDraftItem } from "./receipt-api";
import { Button } from "./ui";
export function ReceiptAmount({
  label,
  value,
  change,
  signed = false,
  emptyAsZero = false,
}: {
  label: string;
  value: number | null;
  change: (n: number | null) => void;
  signed?: boolean;
  emptyAsZero?: boolean;
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
        required={!emptyAsZero}
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
      {value === null && <span className="field-error">Enter an amount.</span>}
    </label>
  );
}
export function ReceiptItemEditor({
  items,
  change,
  draftMode = false,
  processing = false,
}: {
  items: ReceiptDraftItem[];
  change: (items: ReceiptDraftItem[]) => void;
  draftMode?: boolean;
  processing?: boolean;
}) {
  function update(
    id: string,
    patch: Partial<ReceiptDraftItem>,
    recalculate = false,
  ) {
    change(
      items.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch, taxNotChecked: false };
        if (recalculate && !next.manualFinal)
          next.finalCents =
            next.amountCents === null
              ? null
              : next.amountCents +
                next.taxCents +
                next.extraCents -
                next.discountCents;
        return next;
      }),
    );
  }
  return (
    <div className="receipt-item-editor">
      {items.map((item, index) => (
        <article className="receipt-edit-row" key={item.id}>
          <div className="receipt-item-title">
            <span className="receipt-index">{index + 1}</span>
            <label>
              Item name
              <input
                required
                maxLength={160}
                value={item.name}
                onChange={(e) => update(item.id, { name: e.target.value })}
              />
            </label>
            <Button
              variant="text"
              onClick={() => change(items.filter((i) => i.id !== item.id))}
            >
              Remove
            </Button>
          </div>
          <div className="receipt-costs">
            <label>
              Quantity
              <input
                maxLength={40}
                value={item.quantity}
                onChange={(e) => update(item.id, { quantity: e.target.value })}
              />
            </label>
            <ReceiptAmount
              label="Final cost · CAD"
              value={item.finalCents}
              change={(finalCents) =>
                update(item.id, { finalCents, manualFinal: true })
              }
            />
          </div>
          {draftMode && (processing || item.taxNotChecked) && (
            <span className="receipt-tax-status" role="status">
              {processing ? "Checking tax" : "Taxable · not checked"}
            </span>
          )}
          {draftMode && (
            <label className="receipt-tax-toggle">
              <input
                type="checkbox"
                aria-label="Taxable"
                checked={item.taxable !== false}
                onChange={(e) => update(item.id, { taxable: e.target.checked })}
              />
              {item.taxable === false ? "Not taxable" : "Taxable"}
            </label>
          )}
          {item.manualFinal && draftMode && (
            <p>
              Final cost entered manually.{" "}
              <Button
                variant="text"
                onClick={() => update(item.id, { manualFinal: false }, true)}
              >
                Use calculated cost
              </Button>
            </p>
          )}
          <details>
            <summary>Original text & price details</summary>
            <p className="receipt-original">
              {item.originalText || "Manually added item"}
            </p>
            <div className="receipt-costs">
              <ReceiptAmount
                label="Printed amount"
                value={item.amountCents}
                change={(amountCents) => update(item.id, { amountCents }, true)}
              />
              <ReceiptAmount
                label="Tax"
                emptyAsZero
                value={item.taxCents}
                change={(taxCents) => {
                  if (taxCents !== null) update(item.id, { taxCents }, true);
                }}
              />
              <ReceiptAmount
                label="Discount"
                emptyAsZero
                value={item.discountCents}
                change={(discountCents) => {
                  if (discountCents !== null)
                    update(item.id, { discountCents }, true);
                }}
              />
              <ReceiptAmount
                label="Other adjustment"
                emptyAsZero
                value={item.extraCents}
                signed
                change={(extraCents) => {
                  if (extraCents !== null)
                    update(item.id, { extraCents }, true);
                }}
              />
            </div>
          </details>
        </article>
      ))}
      <Button
        variant="secondary"
        disabled={items.length >= 200}
        onClick={() =>
          change([
            ...items,
            {
              id: requestId(),
              name: "",
              originalText: "",
              quantity: "1",
              taxable: true,
              amountCents: null,
              taxCents: 0,
              discountCents: 0,
              extraCents: 0,
              finalCents: null,
            },
          ])
        }
      >
        + Add an item
      </Button>
      <p className="receipt-subtotal">
        Item total{" "}
        <strong>
          {money(items.reduce((s, i) => s + (i.finalCents ?? 0), 0))}
        </strong>
      </p>
    </div>
  );
}
