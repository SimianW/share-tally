import { useEffect, useRef, useState } from "react";
import { money } from "./bill-api";
import type { LegacyCorrectionItem } from "./receipt-api";
import { requestId } from "./request-id";
import Dialog from "./Dialog";
import { ReceiptAmount } from "./ReceiptAmount";
import { ReceiptItemRow } from "./ReceiptItemRow";
import { Button } from "./ui";

// Legacy bills have known per-item components, but no receipt-wide allocation
// inputs. Recalculate only in response to a price edit, never on opening/saving:
// an untouched historical final may differ from its components for unknown reasons.
export function LegacyItemEditor({ items, change }: {
  items: LegacyCorrectionItem[];
  change: (items: LegacyCorrectionItem[]) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const fields = useRef<HTMLDivElement>(null);
  const active = items.find(item => item.id === selected);
  useEffect(() => {
    fields.current?.querySelector<HTMLInputElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [selected]);
  function close() {
    const invalid = fields.current?.querySelector<HTMLInputElement>("input:invalid");
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
    } else setSelected(null);
  }
  function update(patch: Partial<LegacyCorrectionItem>, recalculate = false) {
    change(items.map(item => {
      if (item.id !== selected) return item;
      // Re-entering the same value does not change unknown historical provenance.
      if (Object.entries(patch).every(([key, value]) => item[key as keyof LegacyCorrectionItem] === value)) return item;
      const next = { ...item, ...patch };
      if (recalculate && !next.manualFinal) {
        next.finalCents = next.amountCents === null ? null
          : next.amountCents + next.taxCents + next.extraCents - next.discountCents;
        next.manualFinal = false;
      }
      return next;
    }));
  }
  return <section className="receipt-review-items" aria-label="Legacy receipt items">
    <p>This older bill has no stored receipt summary or frozen tax rate. Edit its per-item tax and adjustments directly. Existing amounts stay unchanged until you edit a price component or set a final cost manually.</p>
    <div className="receipt-list-heading"><strong>{items.length} {items.length === 1 ? "item" : "items"}</strong><span>Tap an item to edit</span></div>
    <div className="receipt-item-list">
      {items.map(item => <ReceiptItemRow key={item.id} item={{ ...item, manualFinal: !!item.manualFinal }} mode="correction" selected={item.id === selected} onOpen={() => setSelected(item.id)} />)}
    </div>
    <Button variant="secondary" disabled={items.length >= 200} onClick={() => {
      const id = requestId();
      change([...items, { id, name: "", originalText: "", quantity: "1", amountCents: null, discountCents: 0, taxCents: 0, extraCents: 0, finalCents: null, manualFinal: false }]);
      setSelected(id);
    }}>Add an item</Button>
    {active && <Dialog title="Correct legacy item" className="receipt-sheet" closeLabel="Close editor" close={close}>
      <div ref={fields} key={active.id} className="receipt-sheet-content">
        <div className="receipt-original-text"><span className="eyebrow">ON THE RECEIPT</span><p>{active.originalText || "Manually added item"}</p></div>
        <div className="receipt-editor-fields">
          <label className="receipt-field-wide">Item name<input data-autofocus required maxLength={160} value={active.name} onChange={event => update({ name: event.target.value })} /></label>
          <label>Quantity<input maxLength={40} value={active.quantity} onChange={event => update({ quantity: event.target.value })} /></label>
          <ReceiptAmount label="Printed price" value={active.amountCents} change={amountCents => update({ amountCents }, true)} />
          <ReceiptAmount label="Item discount" emptyAsZero value={active.discountCents} change={discountCents => update({ discountCents: discountCents ?? 0 }, true)} />
          <ReceiptAmount label="Tax" emptyAsZero value={active.taxCents} change={taxCents => update({ taxCents: taxCents ?? 0 }, true)} />
          <ReceiptAmount label="Other adjustment" emptyAsZero signed value={active.extraCents} change={extraCents => update({ extraCents: extraCents ?? 0 }, true)} />
        </div>
        <p className="receipt-field-help">Taxability is unavailable for this older bill. Its tax amount is entered directly, not calculated from a frozen rate. Printed price is the whole line amount, including its quantity.</p>
        <dl className="receipt-cost-breakdown"><div className="receipt-final-cost"><dt>{active.manualFinal ? "Final cost · manual override" : "Final cost"}</dt><dd><output aria-label="Final cost">{active.finalCents === null ? "Missing cost" : money(active.finalCents)}</output></dd></div></dl>
        {active.manualFinal ? <div className="receipt-manual-override">
          <strong>Manual override</strong><p>This amount replaces printed price plus tax and adjustments minus discount.</p>
          <ReceiptAmount label="Final cost · CAD" value={active.finalCents} change={finalCents => update({ finalCents, manualFinal: true })} />
          <Button variant="text" onClick={() => update({ manualFinal: false }, true)}>Use item calculation</Button>
        </div> : <Button variant="text" onClick={() => update({ manualFinal: true })}>Set final manually</Button>}
        <div className="receipt-editor-bottom">
          <Button variant="text" className="draft-delete-text" onClick={() => {
            change(items.filter(item => item.id !== selected));
            setSelected(null);
          }}>Remove item</Button>
          <Button onClick={close}>Done</Button>
        </div>
      </div>
    </Dialog>}
  </section>;
}
