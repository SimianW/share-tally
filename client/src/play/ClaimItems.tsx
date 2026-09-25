import { useState, type ReactNode } from "react";
import { money, type Bill } from "./bill-api";
import type { BillItem } from "./receipt-api";
import { fraction, one, sum, subtract, text, shortText, parse, lessOrEqual, cost, share, signed } from "./claim-fractions";
import Dialog from "./Dialog";
import { ReceiptItemRow } from "./ReceiptItemRow";
import { ReceiptPhoto } from "./ReceiptPhoto";
import { Button, Avatar } from "./ui";

export function ClaimItems({ bill, selection, change, busy, terminal, confirmAction, error }: {
  bill: Bill; selection: Record<string, string>; change: (id: string, fraction: string) => void;
  busy: boolean; terminal: boolean; confirmAction: ReactNode; error: string;
}) {
  const items = bill.items ?? [];
  const own = bill.participants.find((p) => p.isCurrentUser);
  const [filter, setFilter] = useState<"unclaimed" | "mine" | "all">("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [summary, setSummary] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [customError, setCustomError] = useState("");
  const [customChoices, setCustomChoices] = useState<Record<string, string>>({});
  const [selectedCustom, setSelectedCustom] = useState<Record<string, boolean>>({});
  const active = items.find((i) => i.id === activeId);
  const others = (item: BillItem) => sum(item.claims.filter((c) => c.userId !== own?.userId));
  const room = (item: BillItem) => subtract(one, others(item));
  const left = (item: BillItem) => subtract(one, sum(item.claims));
  const mine = (item: BillItem) => !!selection[item.id] || item.claims.some((c) => c.userId === own?.userId);
  const unclaimed = items.filter((i) => left(i).n > 0n);
  const myItems = items.filter(mine);
  const displayed = filter === "unclaimed" ? unclaimed : filter === "mine" ? myItems : items;
  function open(item: BillItem) {
    setActiveId(item.id);
    setCustomOpen(false);
    setCustomError("");
  }
  function choose(item: BillItem, value: string, custom = false) {
    change(item.id, value);
    if (custom) setCustomChoices((previous) => ({ ...previous, [item.id]: value }));
    setSelectedCustom((previous) => ({ ...previous, [item.id]: custom }));
    setCustomOpen(false);
    setCustomError("");
  }
  function saveCustom(item: BillItem) {
    const value = parse(customText);
    if (!value) { setCustomError("Use a positive fraction up to 1, with numerator and denominator at most 10,000."); return; }
    if (!lessOrEqual(value, room(item))) { setCustomError(`Only ${text(room(item))} is available to you.`); return; }
    choose(item, text(value), true);
  }
  return <>
    <div className="claim-filters" aria-label="Filter items">
      {([ ["unclaimed", `Unclaimed (${unclaimed.length})`], ["mine", `Mine (${myItems.length})`], ["all", `All (${items.length})`] ] as const).map(([key, label]) =>
        <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
    </div>
    <div className="receipt-item-list claim-list">
      {displayed.map((item) => {
        const held = sum(item.claims);
        const myClaim = item.claims.find((c) => c.userId === own?.userId);
        const selected = parse(selection[item.id] ?? "");
        return <ReceiptItemRow key={item.id} item={item} mode="claim" selected={activeId === item.id} onOpen={() => open(item)}
          accessibleLabel={`View ${item.name} · ${money(item.finalCents)}`}
          badges={<>{myClaim && <span className={`receipt-badge${myClaim.confirmedAt ? "" : " receipt-badge-warning"}`}>{myClaim.confirmedAt ? "Your claim" : "Your reservation · reconfirm"}</span>}{item.claims.some((claim) => !claim.confirmedAt) && <span className="receipt-badge receipt-badge-warning">Reserved · needs reconfirmation</span>}</>}
          secondary={<span className="claim-row-details">
            <span className="claim-avatars">{item.claims.map((claim) => {
              const participant = bill.participants.find((p) => p.userId === claim.userId);
              return participant && <span key={claim.userId} className={claim.confirmedAt ? "" : "claim-reserved-avatar"} title={`${participant.displayName}: ${text(fraction(BigInt(claim.numerator), BigInt(claim.denominator)))} · ${claim.confirmedAt ? "confirmed" : "reserved, needs reconfirmation"}`}><Avatar name={participant.displayName} imageUrl={participant.imageUrl} fallbackImageUrl={participant.fallbackImageUrl} small /></span>;
            })}</span>
            <span className="claim-meter" role="img" aria-label={`${text(held)} claimed; ${text(left(item))} left`}><span style={{ width: `${Number(held.n * 100n / held.d)}%` }} /></span>
            <span>{shortText(left(item))} left</span>
            {selected && <strong className="claim-mine">Your portion {text(selected)}{myClaim && !myClaim.confirmedAt ? " · reserved" : myClaim && text(selected) !== `${myClaim.numerator}/${myClaim.denominator}` ? " · not submitted" : !myClaim ? " · not submitted" : ""}</strong>}
          </span>} />;
      })}
      {!displayed.length && <p className="receipt-list-empty">No items in this filter.</p>}
    </div>
    {active && <Dialog title={active.name} kicker="CLAIM AN ITEM" className="receipt-sheet claim-sheet" closeLabel="Close claim" close={() => setActiveId(null)}>
      <div className="receipt-sheet-content">
        <div className="receipt-original-text"><span className="eyebrow">ON THE RECEIPT</span><p>{active.originalText || "Manually added item"}</p></div>
        <div><span className="eyebrow">HOW THIS COST WAS CALCULATED</span>
          {active.manualFinal === true ? <p>Set manually by {bill.participants.find((p) => p.userId === bill.initiatorId)?.displayName ?? "the initiator"}</p>
            : !bill.receipt || active.manualFinal == null || active.allocatedDiscountCents == null || active.allocatedTaxCents == null || active.allocatedExtraCents == null ? <p>Cost calculation not available for this older bill.</p>
              : <dl className="receipt-cost-breakdown">
                <div><dt>Printed price</dt><dd>{money(active.amountCents)}</dd></div>
                <div><dt>Own discount</dt><dd>−{money(active.discountCents)}</dd></div>
                <div><dt>Receipt discount share</dt><dd>−{money(active.allocatedDiscountCents)}</dd></div>
                <div><dt>Tax share</dt><dd>{money(active.allocatedTaxCents)}</dd></div>
                <div><dt>Other adjustments share</dt><dd>{signed(active.allocatedExtraCents)}</dd></div>
                <div className="receipt-final-cost"><dt>Final cost</dt><dd>{money(active.finalCents)}</dd></div>
              </dl>}
        </div>
        {bill.photo && <ReceiptPhoto id={bill.photo.draftId} expired={bill.photo.expired} />}
        <p className="receipt-field-help">{text(room(active))} available to you. Other claims and reservations hold the rest. Your choices are not submitted until you confirm.</p>
        {!terminal && own && <div className="claim-options">
          {([ ["1", "All of it"], ["1/2", "1/2"], ["1/3", "1/3"], ["1/4", "1/4"], ["1/5", "1/5"], ["1/6", "1/6"] ] as const).map(([value, label], index) => {
            const f = parse(value)!;
            return <button type="button" key={value} className={`claim-option${index === 0 ? " claim-option-all" : ""}`}
              aria-pressed={!customOpen && !selectedCustom[active.id] && (parse(selection[active.id] ?? "")?.n === f.n && parse(selection[active.id] ?? "")?.d === f.d)}
              disabled={busy || !lessOrEqual(f, room(active))} onClick={() => choose(active, value)}>{label} · {money(cost(active.finalCents, f))}</button>;
          })}
          <button type="button" className="claim-option" aria-label={customChoices[active.id] && parse(customChoices[active.id]) ? `Custom · ${customChoices[active.id]} · ${money(cost(active.finalCents, parse(customChoices[active.id])!))}` : "Custom"} aria-pressed={!customOpen && !!selectedCustom[active.id]} disabled={busy || room(active).n <= 0n}
            onClick={() => { setCustomOpen(true); setCustomText(customChoices[active.id] || selection[active.id] || ""); setCustomError(""); }}>
            {customChoices[active.id] && parse(customChoices[active.id]) ? `${customChoices[active.id]} · ${money(cost(active.finalCents, parse(customChoices[active.id])!))}` : "Custom"}
          </button>
          {customOpen && <div className="claim-custom"><label>Custom fraction<input autoFocus aria-label="Custom fraction" placeholder="4/5" value={customText} onChange={(event) => setCustomText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveCustom(active); }} /></label>
            <Button onClick={() => saveCustom(active)}>Use custom fraction</Button>{customError && <p role="alert">{customError}</p>}</div>}
          {!!selection[active.id] && <Button variant="text" className="claim-remove" onClick={() => choose(active, "")}>Remove my claim</Button>}
        </div>}
      </div>
    </Dialog>}
    {summary && <Dialog title="Receipt summary" kicker="PRINTED TOTALS · CAD" className="receipt-sheet" closeLabel="Close summary" close={() => setSummary(false)}>
      <div className="receipt-sheet-content"><p className="receipt-field-help">Read-only receipt totals from the initiated bill.</p>
        {bill.receipt ? <dl className="receipt-cost-breakdown">
          <div><dt>Subtotal</dt><dd>{bill.receipt.subtotalCents == null ? "Not available" : money(bill.receipt.subtotalCents)}</dd></div>
          <div><dt>Discount</dt><dd>{money(bill.receipt.discountCents)}</dd></div>
          <div><dt>Tax{bill.receipt.taxLabel ? ` · ${bill.receipt.taxLabel}` : ""}</dt><dd>{money(bill.receipt.taxCents)}</dd></div>
          <div><dt>Other adjustments</dt><dd>{signed(bill.receipt.extraCents)}</dd></div>
          <div><dt>Printed prices include tax</dt><dd>{bill.receipt.pricesIncludeTax ? "Yes" : "No"}</dd></div>
          <div className="receipt-final-cost"><dt>Receipt total</dt><dd>{money(bill.receipt.totalCents)}</dd></div>
        </dl> : <p>Receipt summary not available for this older bill.</p>}
        <Button onClick={() => setSummary(false)}>Done</Button>
      </div>
    </Dialog>}
    <div className="claim-sticky-footer">
      {error && <p role="alert" className="claim-footer-error">{error}</p>}
      <button type="button" className="claim-summary-trigger" aria-haspopup="dialog" onClick={() => setSummary(true)}>Receipt summary</button>
      <output className="claim-share" aria-live="polite">Your share {money(share(items, selection))}</output>
      {confirmAction}
    </div>
  </>;
}
