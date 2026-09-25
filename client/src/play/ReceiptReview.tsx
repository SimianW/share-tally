import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, LoaderCircle, LockKeyhole, Plus, ReceiptText } from "lucide-react";
import { money } from "./bill-api";
import type { ReceiptData, ReceiptDraftItem, ReceiptPricing } from "./receipt-api";
import { requestId } from "./request-id";
import Dialog from "./Dialog";
import { ReceiptAmount } from "./ReceiptAmount";
import { ReceiptItemRow } from "./ReceiptItemRow";
import { ReceiptFilterChips } from "./ReceiptFilterChips";
import { Notification } from "./Notification";
import { Button } from "./ui";

function fieldsValid(container: HTMLElement | null) {
  const invalid = container?.querySelector<HTMLInputElement>("input:invalid");
  if (!invalid) return true;
  invalid.reportValidity();
  invalid.focus();
  return false;
}

function itemNeedsCheck(item: ReceiptDraftItem) {
  return item.needsCheck ?? (item.amountCents === null);
}

export function ReceiptReviewItems({ items, change, mode = "review", hasFrozenRate = true, processing = false, processingStatus = "ready", scanned = false, onConfirm }: { items: ReceiptDraftItem[]; change: (items: ReceiptDraftItem[]) => void; mode?: "review" | "correction"; hasFrozenRate?: boolean; processing?: boolean; processingStatus?: "ready" | "processing" | "fallback"; scanned?: boolean; onConfirm?: (itemId: string, flag: "needsCheck" | "taxNotChecked") => Promise<boolean> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "needs-check" | "tax-not-checked">("all");
  const [readyDismissed, setReadyDismissed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const originallyFlagged = useRef(false);
  const index = items.findIndex((item) => item.id === selected);
  const active = items[index];
  const fields = useRef<HTMLDivElement>(null);
  const needsCheckCount = items.filter(itemNeedsCheck).length;
  const taxNotCheckedCount = items.filter((item) => item.taxNotChecked).length;
  const visible = mode !== "review" || filter === "all" ? items : items.filter((item) => filter === "needs-check" ? itemNeedsCheck(item) : item.taxNotChecked);
  useEffect(() => {
    fields.current?.querySelector<HTMLInputElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [selected]);
  const open = (item: ReceiptDraftItem) => { originallyFlagged.current = itemNeedsCheck(item); setSelected(item.id); };
  const close = () => { if (fieldsValid(fields.current) && !confirming) setSelected(null); };
  const finish = async () => {
    if (!active || !fieldsValid(fields.current) || confirming || processing) return;
    if (originallyFlagged.current && onConfirm) {
      setConfirming(true);
      try { if (!await onConfirm(active.id, "needsCheck")) return; }
      finally { setConfirming(false); }
    }
    setSelected(null);
  };
  const confirmTax = async () => {
    if (!active || !onConfirm || confirming || processing) return;
    setConfirming(true);
    try { await onConfirm(active.id, "taxNotChecked"); }
    finally { setConfirming(false); }
  };
  const update = (patch: Partial<ReceiptDraftItem>) => change(items.map((item) => item.id === selected ? { ...item, ...patch, needsCheck: false, ...("taxable" in patch ? { taxNotChecked: false } : {}), ...("discountCents" in patch ? { discountSource: undefined } : {}) } : item));
  const move = (offset: number) => { if (fieldsValid(fields.current)) open(items[index + offset]); };
  return <section className="receipt-review-items" aria-label="Receipt items">
    <div className="receipt-list-heading"><strong>{items.length} {items.length === 1 ? "item" : "items"}</strong><span>{processing ? "Editing paused" : "Tap an item to edit"}</span></div>
    {mode === "review" && <>
      {processing && <Notification tone="info" title="Naming items and checking tax…">You can review the printed items now. Editing unlocks when the check finishes.</Notification>}
      {!processing && processingStatus === "ready" && scanned && !readyDismissed && <Notification tone="success" title="Names and tax filled in" onDismiss={() => setReadyDismissed(true)}>Everything is editable now. Fix anything that looks wrong.</Notification>}
      {!processing && taxNotCheckedCount > 0 && <Notification tone="warning" title={taxNotCheckedCount === items.length ? "AI tax check timed out, so please confirm which items are taxable" : `Tax wasn't checked for ${taxNotCheckedCount} ${taxNotCheckedCount === 1 ? "item" : "items"}`}>
        Affected items kept their receipt names and are set to taxable. Turn tax off if it isn't charged, or confirm the setting.
        {taxNotCheckedCount > 0 && <Button variant="text" onClick={() => setFilter("tax-not-checked")}>Show them ({taxNotCheckedCount}) <ArrowRight size={14} aria-hidden="true" /></Button>}
      </Notification>}
      <ReceiptFilterChips options={[{ id: "all", label: "All" }, { id: "needs-check", label: "Needs check", count: needsCheckCount }, ...(taxNotCheckedCount ? [{ id: "tax-not-checked" as const, label: "Tax not checked", count: taxNotCheckedCount }] : [])]} value={filter} onChange={setFilter} />
    </>}
    <div className="receipt-item-list">
      {visible.map((item) => <ReceiptItemRow key={item.id} item={item} mode={mode} selected={item.id === selected} printedCents={processing ? item.amountCents : undefined} badges={<>{mode === "review" && itemNeedsCheck(item) && <span className="receipt-badge receipt-badge-warning">{item.amountCents === null ? "Missing price" : "⚠ Needs check"}</span>}{(processing || item.taxNotChecked) && <span className="receipt-badge receipt-badge-warning">{processing && <LoaderCircle size={12} className="receipt-processing-spin" aria-hidden="true" />}{processing ? "Checking tax" : "Taxable · not checked"}</span>}</>} onOpen={() => open(item)} />)}
      {!items.length && <p className="receipt-list-empty">Add your first item, then enter its printed price.</p>}
      {!!items.length && !visible.length && <p className="receipt-list-empty" role="status">{filter === "tax-not-checked" ? "All done — no tax settings need checking." : "All checked — no items need checking."}</p>}
    </div>
    {mode === "review" && <Button variant="secondary" disabled={processing || items.length >= 200} onClick={() => {
      const id = requestId();
      change([...items, { id, name: "", originalText: "", quantity: "1", taxable: true, amountCents: null, discountCents: 0, finalCents: null, manualFinal: false }]);
      originallyFlagged.current = true;
      setSelected(id);
    }}><Plus size={16} aria-hidden="true" /> Add an item</Button>}
    {active && <Dialog title={mode === "correction" ? "Correct item price" : "Edit receipt item"} kicker={`ITEM ${index + 1} OF ${items.length}`} className="receipt-sheet" closeLabel="Close editor" close={close}>
      <div ref={fields} key={active.id} className="receipt-sheet-content">
        {processing && <p className="receipt-lock-note" role="status"><LockKeyhole size={18} aria-hidden="true" /> Checking the name and tax for this item. Editing unlocks when it finishes.</p>}
        {!processing && active.taxNotChecked && <p className="receipt-lock-note receipt-lock-warning">Tax wasn't checked automatically. This item is set to taxable; turn it off if it isn't taxed.</p>}
        <div className="receipt-original-text"><span className="eyebrow">ON THE RECEIPT</span><p>{active.originalText || "Manually added item"}</p></div>
        <fieldset className="receipt-editor-controls" disabled={processing}>
        <div className="receipt-editor-fields">
          <label className="receipt-field-wide">Item name<input data-autofocus required={mode === "correction"} maxLength={160} value={active.name} onChange={(event) => update({ name: event.target.value })} /></label>
          <label>Quantity<input maxLength={40} value={active.quantity} onChange={(event) => update({ quantity: event.target.value })} /></label>
          <ReceiptAmount label="Printed price" required={mode === "correction"} value={active.amountCents} change={(amountCents) => update({ amountCents })} />
          <ReceiptAmount label={active.discountSource === "receipt" ? "Item discount (from receipt)" : "Item discount"} emptyAsZero value={active.discountCents} change={(discountCents) => update({ discountCents: discountCents ?? 0 })} />
          <label className="receipt-tax-toggle"><input type="checkbox" checked={active.taxable !== false} onChange={(event) => update({ taxable: event.target.checked })} />Taxable</label>
        </div>
        <p className="receipt-field-help">Printed price is the whole line amount, including its quantity.{mode === "correction" && hasFrozenRate && " Corrections use the tax rate frozen when this bill was initiated; only this item's claims need reconfirmation."}</p>
        {mode === "correction" && active.allocatedDiscountCents == null && <p className="receipt-field-help">Some receipt allocations are unavailable for this older bill. Its cost remains unchanged unless you set it manually.</p>}
        </fieldset>
        <dl className="receipt-cost-breakdown">
          <div><dt>Receipt discount share</dt><dd>{active.allocatedDiscountCents == null ? "Not yet calculated" : active.allocatedDiscountCents ? `−${money(active.allocatedDiscountCents)}` : money(0)}</dd></div>
          <div><dt>Tax share</dt><dd>{processing ? "Checking tax…" : active.allocatedTaxCents == null ? "Not yet calculated" : money(active.allocatedTaxCents)}</dd></div>
          <div><dt>Other adjustments share</dt><dd>{active.allocatedExtraCents == null ? "Not yet calculated" : money(active.allocatedExtraCents)}</dd></div>
          <div className="receipt-final-cost"><dt>{active.manualFinal ? "Final cost · manual override" : "Final cost"}</dt><dd><output aria-label="Final cost">{processing ? "After checking" : active.finalCents === null ? "Missing cost" : money(active.finalCents)}</output></dd></div>
        </dl>
        {active.taxNotChecked && !processing && mode === "review" && <Button disabled={confirming} onClick={() => void confirmTax()}><Check size={16} aria-hidden="true" /> Tax setting is right</Button>}
        <fieldset className="receipt-editor-controls" disabled={processing}>
        {active.manualFinal ? <div className="receipt-manual-override">
          <strong>Manual override</strong><p>This amount replaces the calculated final cost. Receipt allocations above are for reference.</p>
          <ReceiptAmount label="Final cost · CAD" required={mode === "correction"} value={active.finalCents} change={(finalCents) => update({ finalCents })} />
          <Button variant="text" onClick={() => update({ manualFinal: false })}>Use receipt calculation</Button>
        </div> : <Button variant="text" onClick={() => update({ manualFinal: true })}>Set final manually</Button>}
        </fieldset>
        <div className="receipt-editor-navigation">
          <Button variant="secondary" disabled={index === 0} onClick={() => move(-1)}><ArrowLeft size={16} aria-hidden="true" />Previous item</Button>
          <Button variant="secondary" disabled={index === items.length - 1} onClick={() => move(1)}>Next item<ArrowRight size={16} aria-hidden="true" /></Button>
        </div>
        <div className="receipt-editor-bottom">{mode === "review" && !processing && <Button variant="text" className="draft-delete-text" onClick={() => {
          change(items.filter((item) => item.id !== selected));
          setSelected(null);
        }}>Remove item</Button>}<Button disabled={confirming} onClick={() => processing ? setSelected(null) : void finish()}>{processing ? "Done" : mode === "review" && itemNeedsCheck(active) ? "Confirm item" : "Done"}</Button></div>
      </div>
    </Dialog>}
  </section>;
}

const defaultPricing: ReceiptPricing = { subtotalCents: null, taxCents: 0, discountCents: 0, extraCents: 0, pricesIncludeTax: false };
export function ReceiptSummary({ data, change, close, disabled = false }: { data: ReceiptData; disabled?: boolean; change: (patch: Partial<ReceiptData>) => void; close: () => void }) {
  const fields = useRef<HTMLDivElement>(null);
  const receipt = data.receipt ?? defaultPricing;
  const finish = () => { if (fieldsValid(fields.current)) close(); };
  return <Dialog title="Receipt summary" kicker="PRINTED TOTALS · CAD" className="receipt-sheet" closeLabel="Close summary" close={finish}>
    <div ref={fields} className="receipt-sheet-content">
      <p className="receipt-field-help">Check the printed totals. Changes recalculate every item immediately; the amount you paid stays as entered.</p>
      <fieldset disabled={disabled} className="receipt-summary-controls">
        <div className="receipt-summary-fields">
          <ReceiptAmount label="Receipt subtotal" required={false} value={receipt.subtotalCents} change={(subtotalCents) => change({ receipt: { ...receipt, subtotalCents } })} />
          <ReceiptAmount label="Receipt discount" emptyAsZero value={receipt.discountCents} change={(discountCents) => change({ receipt: { ...receipt, discountCents: discountCents ?? 0 } })} />
          <ReceiptAmount label="Receipt tax" emptyAsZero value={receipt.taxCents} change={(taxCents) => change({ receipt: { ...receipt, taxCents: taxCents ?? 0 } })} />
          <ReceiptAmount label="Other adjustments" emptyAsZero signed value={receipt.extraCents} change={(extraCents) => change({ receipt: { ...receipt, extraCents: extraCents ?? 0 } })} />
          <ReceiptAmount label="Receipt total" required={false} value={data.totalCents} change={(totalCents) => change({ totalCents })} />
        </div>
        <label className="receipt-tax-toggle"><input type="checkbox" checked={receipt.pricesIncludeTax} onChange={(event) => change({ receipt: { ...receipt, pricesIncludeTax: event.target.checked } })} />Printed prices include tax</label>
      </fieldset>
      <p className="receipt-field-help">Receipt discounts and other adjustments are shared proportionally across all items. Tax is shared by taxable items only, unless printed prices already include it. Subtotal is a reference; it does not change printed item prices.</p>
      <Button onClick={finish}>Done</Button>
    </div>
  </Dialog>;
}

export function ReceiptReconciliation({ data, openSummary, processing = false }: { data: ReceiptData; openSummary: () => void; processing?: boolean }) {
  const printed = data.items.reduce((sum, item) => sum + (item.amountCents ?? 0) - item.discountCents, 0);
  const total = data.items.reduce((sum, item) => sum + (item.finalCents ?? 0), 0);
  const missing = data.items.some((item) => item.finalCents === null);
  const difference = data.totalCents === null ? null : Math.abs(total - data.totalCents);
  const matches = !processing && !missing && difference === 0;
  return <button type="button" className={`receipt-reconciliation${matches ? " is-matched" : ""}`} onClick={openSummary} aria-haspopup="dialog">
    <ReceiptText size={21} aria-hidden="true" /><span>
      <strong>{processing ? `Printed items ${money(printed)}` : matches ? <><Check size={15} aria-hidden="true" /> Matches receipt</> : missing ? "Some item costs are missing" : difference === null ? "Add the receipt total" : `Off by ${money(difference)}`}</strong>
      <span>{processing ? `Receipt subtotal ${data.receipt?.subtotalCents == null ? "—" : money(data.receipt.subtotalCents)}` : <>Items {money(total)}{missing ? " so far" : ""} · Receipt {data.totalCents === null ? "—" : money(data.totalCents)}</>}</span>
      <small>{processing ? "Tax and final costs appear after checking · View receipt summary" : `Receipt summary · ${matches ? "View or edit totals" : "You can still continue"}`}</small>
    </span><ChevronRight size={18} aria-hidden="true" />
  </button>;
}
