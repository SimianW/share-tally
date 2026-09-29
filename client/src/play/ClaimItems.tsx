import { useEffect, useRef, useState, type ReactNode } from "react";
import { money, type Bill } from "./bill-api";
import type { BillItem } from "./receipt-api";
import { fraction, one, sum, subtract, text, shortText, parse, lessOrEqual, cost, share, signed } from "./claim-fractions";
import Dialog from "./Dialog";
import { ReceiptItemRow } from "./ReceiptItemRow";
import { ReceiptPhoto } from "./ReceiptPhoto";
import { ReceiptLinePhoto } from "./ReceiptLinePhoto";
import { Button, Avatar, Icon } from "./ui";

// Long enough to see the chosen portion fill the bar before the sheet moves on.
const ADVANCE_DELAY_MS = 600;

export function ClaimItems({ bill, selection, change, busy, terminal, confirmAction, error }: {
  bill: Bill; selection: Record<string, string>; change: (id: string, fraction: string) => void;
  busy: boolean; terminal: boolean; confirmAction: ReactNode; error: string;
}) {
  const items = bill.items ?? [];
  const own = bill.participants.find((p) => p.isCurrentUser);
  const [filter, setFilter] = useState<"unclaimed" | "mine" | "all">("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  // The list the sheet was opened from, so Previous and Next follow what was on screen.
  const [order, setOrder] = useState<string[]>([]);
  const advance = useRef<number | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  // Previous and Next keep focus on themselves, so the new item is announced instead.
  const [announcement, setAnnouncement] = useState("");
  const [summary, setSummary] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [customError, setCustomError] = useState("");
  const [customChoices, setCustomChoices] = useState<Record<string, string>>({});
  const [selectedCustom, setSelectedCustom] = useState<Record<string, boolean>>({});
  const active = items.find((i) => i.id === activeId);
  const region = active?.receiptRegion;
  const page = bill.photo && !bill.photo.expired ? bill.photo.pages?.find((entry) => entry.pageNumber === region?.pageNumber) : undefined;
  const others = (item: BillItem) => sum(item.claims.filter((c) => c.userId !== own?.userId));
  const room = (item: BillItem) => subtract(one, others(item));
  const left = (item: BillItem) => subtract(one, sum(item.claims));
  const mine = (item: BillItem) => !!selection[item.id] || item.claims.some((c) => c.userId === own?.userId);
  const unclaimed = items.filter((i) => left(i).n > 0n);
  const myItems = items.filter(mine);
  const displayed = filter === "unclaimed" ? unclaimed : filter === "mine" ? myItems : items;
  const sequence = order.filter((id) => items.some((item) => item.id === id));
  const position = active ? sequence.indexOf(active.id) : -1;
  // Located in the opening list, so a pending advance still finds the next item if this one was removed.
  const index = activeId ? order.indexOf(activeId) : -1;
  const before = index < 0 ? [] : order.slice(0, index).reverse();
  const after = index < 0 ? [] : order.slice(index + 1);
  const itemFor = (id: string) => items.find((item) => item.id === id);
  const previousId = before.find(itemFor) ?? null;
  const nextId = after.find(itemFor) ?? null;
  // Auto-advance passes over items others already hold in full; Previous and Next still visit every item.
  const nextOpenId = after.find((id) => {
    const item = itemFor(id);
    return item && room(item).n > 0n;
  }) ?? null;
  // A pending advance reads these when it fires, so a bill refresh during the pause is respected.
  const latest = useRef({ activeId, nextOpenId });
  useEffect(() => { latest.current = { activeId, nextOpenId }; });
  useEffect(() => () => window.clearTimeout(advance.current), []);
  // A bill that completes or is canceled during the pause stays on the item just picked.
  useEffect(() => { if (terminal) window.clearTimeout(advance.current); }, [terminal]);
  // Moving to another item replaces the sheet content; if focus was in it, the heading takes over.
  useEffect(() => {
    const dialog = heading.current?.closest("dialog");
    if (activeId && dialog && !dialog.contains(document.activeElement)) heading.current?.focus({ preventScroll: true });
  }, [activeId]);
  function resetCustom() {
    setCustomOpen(false);
    setCustomError("");
  }
  // Shows an item's sheet, or closes it with null, cancelling any pending advance.
  function showItem(id: string | null) {
    window.clearTimeout(advance.current);
    setActiveId(id);
    setAnnouncement("");
    resetCustom();
  }
  function open(item: BillItem) {
    setOrder(displayed.map((entry) => entry.id));
    showItem(item.id);
  }
  // At either end of the list there is nowhere to go, but the press still cancels a pending advance.
  function navigateToItem(id: string | null) {
    window.clearTimeout(advance.current);
    if (!id) return;
    showItem(id);
    const item = itemFor(id);
    if (item) setAnnouncement(`${item.name}, item ${sequence.indexOf(id) + 1} of ${sequence.length}`);
    heading.current?.closest("dialog")?.scrollTo({ top: 0 });
  }
  function choose(item: BillItem, value: string, custom = false) {
    change(item.id, value);
    if (custom) setCustomChoices((previous) => ({ ...previous, [item.id]: value }));
    setSelectedCustom((previous) => ({ ...previous, [item.id]: custom }));
    resetCustom();
    window.clearTimeout(advance.current);
    // Picking a portion moves on to the next item; after the last one the list and its Confirm button return.
    if (value) advance.current = window.setTimeout(() => {
      const { activeId: current, nextOpenId: next } = latest.current;
      if (current !== item.id) return;
      if (next) navigateToItem(next); else showItem(null);
    }, ADVANCE_DELAY_MS);
  }
  useEffect(() => {
    if (!activeId) return;
    function arrows(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target instanceof Element ? event.target : null;
      // Only this sheet, not a photo viewer opened over it, and never while editing text.
      if (!target || target.closest("dialog") !== heading.current?.closest("dialog") || target.closest("input, textarea, select, [contenteditable]")) return;
      const id = event.key === "ArrowLeft" ? previousId : nextId;
      if (id) event.preventDefault();
      navigateToItem(id);
    }
    // Any other tap, click or key press in the sheet, header included, means the user is not done with this item.
    // Click catches activations that send nothing else, as some assistive technology does. A portion pick still
    // schedules its advance, because its React click handler runs after this capture listener.
    const dialog = heading.current?.closest("dialog");
    const stay = () => window.clearTimeout(advance.current);
    dialog?.addEventListener("pointerdown", stay, true);
    dialog?.addEventListener("keydown", stay, true);
    dialog?.addEventListener("click", stay, true);
    document.addEventListener("keydown", arrows);
    return () => {
      dialog?.removeEventListener("pointerdown", stay, true);
      dialog?.removeEventListener("keydown", stay, true);
      dialog?.removeEventListener("click", stay, true);
      document.removeEventListener("keydown", arrows);
    };
  });
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
            <span className="claim-left">{shortText(left(item))} left</span>
            {selected && <strong className="claim-mine">Your portion {text(selected)}{myClaim && !myClaim.confirmedAt ? " · reserved" : myClaim && text(selected) !== `${myClaim.numerator}/${myClaim.denominator}` ? " · not submitted" : !myClaim ? " · not submitted" : ""}</strong>}
          </span>} />;
      })}
      {!displayed.length && <p className="receipt-list-empty">No items in this filter.</p>}
    </div>
    {active && <Dialog title={active.name} kicker={sequence.length > 1 && position >= 0 ? `CLAIM AN ITEM · ${position + 1} OF ${sequence.length}` : "CLAIM AN ITEM"}
      className="receipt-sheet claim-sheet" closeLabel="Close claim" close={() => showItem(null)} headingRef={heading}
      actions={sequence.length > 1 && <div className="claim-sheet-nav">
        <button type="button" className="icon-button" aria-label="Previous item" aria-keyshortcuts="ArrowLeft" aria-disabled={!previousId} onClick={() => navigateToItem(previousId)}><Icon name="left" size={18} /></button>
        <button type="button" className="icon-button" aria-label="Next item" aria-keyshortcuts="ArrowRight" aria-disabled={!nextId} onClick={() => navigateToItem(nextId)}><Icon name="right" size={18} /></button>
      </div>}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      <div className="receipt-sheet-content" key={active.id}>
        {bill.photo && page && region && region.pageNumber === 1 && <ReceiptLinePhoto id={bill.photo.draftId} version={0} page={page} polygon={region.polygon} subject={active.name}
          fallback={<ReceiptPhoto id={bill.photo.draftId} subject={active.name} />} />}
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
        {/* Like the draft editor, a located item shows its highlighted line instead of the whole receipt. */}
        {bill.photo && !(page && region?.pageNumber === 1) && <ReceiptPhoto id={bill.photo.draftId} expired={bill.photo.expired} subject={active.name} />}
        <p className="receipt-field-help">{text(room(active))} available to you. Other claims and reservations hold the rest. Your choices are not submitted until you confirm.</p>
        {!terminal && own && <div className="claim-options">
          <ClaimPortion finalCents={active.finalCents} room={room(active)} mine={parse(selection[active.id] ?? "")} />
          <div className="claim-portion-choices" role="group" aria-label="Your portion">
            {([ ["1", "All of it"], ["1/2", "1/2"], ["1/3", "1/3"], ["1/4", "1/4"], ["1/5", "1/5"], ["1/6", "1/6"] ] as const).map(([value, label]) => {
              const f = parse(value)!;
              return <button type="button" key={value} aria-label={`${label} · ${money(cost(active.finalCents, f))}`}
                aria-pressed={!customOpen && !selectedCustom[active.id] && (parse(selection[active.id] ?? "")?.n === f.n && parse(selection[active.id] ?? "")?.d === f.d)}
                disabled={busy || !lessOrEqual(f, room(active))} onClick={() => choose(active, value)}>
                <b>{value === "1" ? "All" : <FractionText value={f} />}</b><small>{money(cost(active.finalCents, f))}</small>
              </button>;
            })}
            {(() => {
              const custom = customChoices[active.id] ? parse(customChoices[active.id]) : null;
              return <button type="button" className="claim-portion-custom" aria-label={custom ? `Custom · ${customChoices[active.id]} · ${money(cost(active.finalCents, custom))}` : "Custom"} aria-pressed={!customOpen && !!selectedCustom[active.id]} disabled={busy || room(active).n <= 0n}
                onClick={() => { setCustomOpen(true); setCustomText(customChoices[active.id] || selection[active.id] || ""); setCustomError(""); }}>
                <b>{custom ? <FractionText value={custom} /> : "…"}</b><small>{custom ? money(cost(active.finalCents, custom)) : "Custom"}</small>
              </button>;
            })()}
          </div>
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

type Fraction = NonNullable<ReturnType<typeof parse>>;

// Stacked numerals render alike in every palette font; Unicode ⅕ and ⅙ fall back to another font.
function FractionText({ value }: { value: Fraction }) {
  return <span className="claim-fraction"><sup>{String(value.n)}</sup><span>/</span><sub>{String(value.d)}</sub></span>;
}

// The chosen portion's price, and a bar of what others hold, what is chosen, and what is still free.
function ClaimPortion({ finalCents, room, mine }: { finalCents: number; room: Fraction; mine: Fraction | null }) {
  const others = subtract(one, room);
  const free = mine && lessOrEqual(mine, room) ? subtract(room, mine) : mine ? { n: 0n, d: 1n } : room;
  const width = (f: Fraction) => `${Number((f.n * 10000n) / f.d) / 100}%`;
  return <div className="claim-portion">
    <span className="eyebrow">YOUR PORTION</span>
    <strong className={mine ? "" : "claim-portion-empty"}>{money(mine ? cost(finalCents, mine) : 0)}</strong>
    <span className="claim-portion-caption">{mine ? `${text(mine)} of ${money(finalCents)}` : `Pick a portion of ${money(finalCents)}`}</span>
    <div className="claim-portion-bar" aria-hidden="true">
      {others.n > 0n && <span className="claim-portion-others" style={{ width: width(others) }} />}
      {mine && <span className="claim-portion-mine" style={{ width: width(mine) }} />}
    </div>
    <div className="claim-portion-legend">
      <span><i className="claim-portion-mine" />You</span>
      {others.n > 0n && <span><i className="claim-portion-others" />Others · {text(others)}</span>}
      {free.n > 0n && <span><i />Free · {text(free)}</span>}
    </div>
  </div>;
}
