import { type Bill } from "@share-tally/domain/contracts/bills";
import type { BillItem } from "@share-tally/domain/contracts/receipts";
import { fraction, type Fraction } from '@share-tally/domain/fractions';
import { ArrowRight, Check, CircleAlert, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { claimable, cost, lessOrEqual, one, parse, shortText, subtract, text, zero } from "../../../shared/fractions";
import { money } from "../../../shared/money";
import { Avatar } from "../../../shared/ui/Avatar";
import { Button } from "../../../shared/ui/Button";
import Dialog from "../../../shared/ui/Dialog";
import { Icon } from "../../../shared/ui/Icon";
import { amountChoices } from "../../../shared/ui/portions/amount-portion";
import { PortionChoices } from "../../../shared/ui/portions/PortionPicker";
import { ReceiptLinePhoto } from "../../receipts/photos/ReceiptLinePhoto";
import { ReceiptPhoto } from "../../receipts/photos/ReceiptPhoto";
import { ReceiptItemRow } from "../../receipts/review/ReceiptItemRow";
import { roomFor, unclaimedPortion } from './claim-availability';
import { useClaimChanges } from "./claim-changes";
import { share, signed } from "./claim-fractions";
import { needsReview, type Blocker, type ClaimReview, type ItemAttention, type RemovedItem } from "./claim-review";
import { ClaimPortion, ItemPortionBar } from "./ClaimPortion";

// Long enough to see the chosen portion fill the bar before the sheet moves on.
const ADVANCE_DELAY_MS = 600;

const plural = (count: number, singular: string, many: string) => `${count} ${count === 1 ? singular : many}`;

const itemChoices = (count: number) => amountChoices(count, "All of it");

export function ClaimItems({ bill, selection, review, change, acknowledge, dismissRemoved, busy, terminal, confirmAction, error }: {
  bill: Bill; selection: Record<string, string>; review: ClaimReview;
  change: (id: string, fraction: string) => void;
  /** Marks an item seen at its current version, price and name. */
  acknowledge: (item: BillItem) => void;
  dismissRemoved: (id: string) => void;
  busy: boolean; terminal: boolean; confirmAction: ReactNode; error: string;
}) {
  const items = bill.items ?? [];
  const choices = itemChoices(bill.participants.length);
  const own = bill.participants.find((p) => p.isCurrentUser);
  const changes = useClaimChanges(items, own?.userId);
  // Attention only applies to a participant who can still confirm.
  const reviewing = !terminal && !!own;
  const attention = reviewing ? review.attention : {};
  const blockers = reviewing ? review.blockers : [];
  const initiatorName = own?.userId === bill.initiatorId ? "You" : bill.participants.find((p) => p.userId === bill.initiatorId)?.displayName ?? "The initiator";
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
  const [customChoices, setCustomChoices] = useState<Record<string, string>>({});
  const [selectedCustom, setSelectedCustom] = useState<Record<string, boolean>>({});
  // What the open sheet needed when it opened, so its notices can say what was resolved.
  const [opened, setOpened] = useState<{ id: string; isNew: boolean; attention: boolean } | null>(null);
  const [reviewedHere, setReviewedHere] = useState<string | null>(null);
  const active = items.find((i) => i.id === activeId);
  const region = active?.receiptRegion;
  const page = bill.photo && !bill.photo.expired ? bill.photo.pages?.find((entry) => entry.pageNumber === region?.pageNumber) : undefined;
  const room = (item: BillItem) => roomFor(item, own?.userId);
  const left = unclaimedPortion;
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
  // Updated during commit, so a timer that fires between a render and its effects still sees that render.
  // The item and its attention let a pending advance notice that the item changed or ran out meanwhile.
  const latest = useRef({ activeId, nextOpenId, terminal, items, attention, blockers });
  useLayoutEffect(() => { latest.current = { activeId, nextOpenId, terminal, items, attention, blockers }; });
  useEffect(() => () => window.clearTimeout(advance.current), []);
  // Moving to another item replaces the sheet content; if focus was in it, the heading takes over.
  useEffect(() => {
    const dialog = heading.current?.closest("dialog");
    if (activeId && dialog && !dialog.contains(document.activeElement)) heading.current?.focus({ preventScroll: true });
  }, [activeId]);
  // Shows an item's sheet, or closes it with null, cancelling any pending advance. Seeing an item
  // acknowledges it if it is new or changed without a pick on it; a changed pick needs its own confirmation.
  // A pending advance passes the latest bill; handlers use the one on screen.
  function showItem(id: string | null, { items: current, attention: now, blockers: pending } = { items, attention, blockers }) {
    window.clearTimeout(advance.current);
    setActiveId(id);
    setAnnouncement("");
    setReviewedHere(null);
    setCustomOpen(false);
    const item = id ? current.find((entry) => entry.id === id) : undefined;
    const state = id ? now[id] : undefined;
    setOpened(id ? { id, isNew: !!state?.isNew, attention: pending.length > 0 } : null);
    if (item && state && (state.isNew || state.updated)) acknowledge(item);
  }
  function open(item: BillItem) {
    setOrder(displayed.map((entry) => entry.id));
    showItem(item.id);
  }
  // At either end of the list there is nowhere to go, but the press still cancels a pending advance.
  function navigateToItem(id: string | null, now?: Parameters<typeof showItem>[1]) {
    window.clearTimeout(advance.current);
    if (!id) return;
    showItem(id, now);
    const item = itemFor(id);
    if (item) setAnnouncement(`${item.name}, item ${sequence.indexOf(id) + 1} of ${sequence.length}`);
    heading.current?.closest("dialog")?.scrollTo({ top: 0 });
  }
  // Moves on to the next item with room after a short pause; after the last one the list and its Confirm button return.
  function advanceFrom(item: BillItem) {
    window.clearTimeout(advance.current);
    advance.current = window.setTimeout(() => {
      const { activeId: current, nextOpenId: next, terminal: ended, items: now, attention: state, blockers: pending } = latest.current;
      // A bill that completed or was canceled during the pause stays on the item just picked,
      // and so does an item whose price or name changed or that ran out meanwhile.
      if (current !== item.id || ended) return;
      const live = now.find((entry) => entry.id === item.id);
      if (live && (live.version !== item.version || state[item.id]?.over)) return;
      if (next) navigateToItem(next, { items: now, attention: state, blockers: pending }); else showItem(null);
    }, ADVANCE_DELAY_MS);
  }
  // Picking a portion, or removing one, also counts as having seen the item's current price.
  function choose(item: BillItem, value: string, custom = false) {
    change(item.id, value);
    acknowledge(item);
    if (attention[item.id]?.changed) setReviewedHere(item.id);
    if (custom) setCustomChoices((previous) => ({ ...previous, [item.id]: value }));
    setSelectedCustom((previous) => ({ ...previous, [item.id]: custom }));
    setCustomOpen(false);
    window.clearTimeout(advance.current);
    if (value) advanceFrom(item);
  }
  function seenNewPrice(item: BillItem) {
    acknowledge(item);
    setReviewedHere(item.id);
    advanceFrom(item);
  }
  // Opens what a chip or Next to review points at. A removed item has no sheet, so its row takes focus instead.
  function goTo(blocker: Blocker | undefined) {
    if (!blocker) return;
    if (blocker.kind === "removed") {
      showItem(null);
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-removed="${CSS.escape(blocker.itemId)}"]`);
        row?.scrollIntoView({ block: "center" });
        row?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
      });
      return;
    }
    const inView = activeId ? sequence.includes(blocker.itemId) : displayed.some((item) => item.id === blocker.itemId);
    if (!inView) {
      setFilter("all");
      setOrder(items.map((item) => item.id));
    } else if (!activeId) setOrder(displayed.map((item) => item.id));
    const item = itemFor(blocker.itemId);
    showItem(blocker.itemId);
    if (activeId && item) {
      setAnnouncement(item.name);
      heading.current?.closest("dialog")?.scrollTo({ top: 0 });
    }
  }
  // The next thing needing attention after this item in list order, wrapping around.
  function nextToReview() {
    const position = (blocker: Blocker) => blocker.kind === "item" ? items.findIndex((item) => item.id === blocker.itemId)
      : (review.removed.find((entry) => entry.itemId === blocker.itemId)?.index ?? items.length) - 0.5;
    const others = blockers.filter((blocker) => !(blocker.kind === "item" && blocker.itemId === activeId));
    const here = items.findIndex((item) => item.id === activeId);
    goTo(others.find((blocker) => position(blocker) > here) ?? others[0]);
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
  // When a pick no longer fits, the sheet offers whatever is still left in one tap, but only if
  // that remainder is itself a claimable fraction. It is never rounded to make it one.
  const activeOver = active ? attention[active.id]?.over : null;
  const activeLeft = activeOver && claimable(activeOver.left) ? activeOver.left : null;
  return <>
    <div className="claim-filters" aria-label="Filter items">
      {([ ["unclaimed", `Unclaimed (${unclaimed.length})`], ["mine", `Mine (${myItems.length})`], ["all", `All (${items.length})`] ] as const).map(([key, label]) =>
        <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
    </div>
    <div className="receipt-item-list claim-list">
      {(() => {
        const rows: ReactNode[] = [];
        const removedAt = (index: number) => (reviewing ? review.removed : []).filter((entry) => index < 0 ? entry.index >= items.length : entry.index === index)
          .forEach((entry) => rows.push(<RemovedRow key={`removed-${entry.itemId}`} removed={entry} dismiss={() => dismissRemoved(entry.itemId)} />));
        items.forEach((item, index) => {
          removedAt(index);
          if (!displayed.includes(item)) return;
          const myClaim = item.claims.find((c) => c.userId === own?.userId);
          const selected = parse(selection[item.id] ?? "");
          const state = attention[item.id];
          const free = selected ? (lessOrEqual(selected, room(item)) ? subtract(room(item), selected) : zero) : room(item);
          const tone = state?.over || state?.invalid ? " is-over" : state && needsReview(state) ? " is-review" : "";
          rows.push(<ReceiptItemRow key={item.id} item={item} mode="claim" selected={activeId === item.id} onOpen={() => open(item)} className={tone}
            accessibleLabel={`View ${item.name} · ${money(item.finalCents)}`}
            badges={<>
              {state && <AttentionBadges attention={state} initiatorName={initiatorName} />}
              {myClaim && <span className={`receipt-badge${myClaim.confirmedAt ? "" : " receipt-badge-warning"}`}>{myClaim.confirmedAt ? "Your claim" : "Your reservation · reconfirm"}</span>}
              {item.claims.some((claim) => !claim.confirmedAt) && <span className="receipt-badge receipt-badge-warning">Reserved · needs reconfirmation</span>}
            </>}
            secondary={<span className="claim-row-details">
              <span className="claim-avatars">{item.claims.map((claim) => {
                const participant = bill.participants.find((p) => p.userId === claim.userId);
                return participant && <span key={claim.userId} className={claim.confirmedAt ? "" : "claim-reserved-avatar"} title={`${participant.displayName}: ${text(fraction(BigInt(claim.numerator), BigInt(claim.denominator)))} · ${claim.confirmedAt ? "confirmed" : "reserved, needs reconfirmation"}`}><Avatar name={participant.displayName} imageUrl={participant.imageUrl} fallbackImageUrl={participant.fallbackImageUrl} small /></span>;
              })}</span>
              <span className="claim-meter" role="img" aria-label={`${text(subtract(one, room(item)))} claimed by others${selected ? `; ${text(selected)} picked by you` : ""}; ${text(free)} free`}>
                <ItemPortionBar item={item} participants={bill.participants} ownId={own?.userId} mine={selected} changes={changes} />
              </span>
              {state?.over ? <span className="claim-left is-over">Over by {shortText(state.over.by)}</span> : <span className="claim-left">{shortText(free)} left</span>}
              {selected && <strong className="claim-mine">Your portion {text(selected)}{myClaim && !myClaim.confirmedAt ? " · reserved" : myClaim && text(selected) !== `${myClaim.numerator}/${myClaim.denominator}` ? " · not submitted" : !myClaim ? " · not submitted" : ""}</strong>}
            </span>} />);
        });
        removedAt(-1);
        return rows;
      })()}
      {!displayed.length && !(reviewing && review.removed.length) && <p className="receipt-list-empty">No items in this filter.</p>}
    </div>
    {active && <Dialog title={active.name} kicker={sequence.length > 1 && position >= 0 ? `CLAIM AN ITEM · ${position + 1} OF ${sequence.length}` : "CLAIM AN ITEM"}
      className="receipt-sheet claim-sheet" closeLabel="Close claim" close={() => showItem(null)} headingRef={heading}
      actions={sequence.length > 1 && <div className="claim-sheet-nav">
        <button type="button" className="icon-button" aria-label="Previous item" aria-keyshortcuts="ArrowLeft" aria-disabled={!previousId} onClick={() => navigateToItem(previousId)}><Icon name="left" size={18} /></button>
        <button type="button" className="icon-button" aria-label="Next item" aria-keyshortcuts="ArrowRight" aria-disabled={!nextId} onClick={() => navigateToItem(nextId)}><Icon name="right" size={18} /></button>
      </div>}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      <div className="receipt-sheet-content" key={active.id}>
        {reviewing && <SheetNotices item={active} attention={attention[active.id]} mine={parse(selection[active.id] ?? "")}
          isNew={opened?.id === active.id && opened.isNew} reviewed={reviewedHere === active.id}
          initiatorName={initiatorName} seen={() => seenNewPrice(active)} />}
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
          <ClaimPortion item={active} participants={bill.participants} ownId={own.userId} mine={parse(selection[active.id] ?? "")}
            changes={changes} over={activeOver ?? null} />
          {(() => {
            const picked = parse(selection[active.id] ?? "");
            const even = choices[0];
            const isEven = picked?.n === even.fraction.n && picked?.d === even.fraction.d;
            const pressed = selectedCustom[active.id] ? (isEven ? even.key : "custom")
              : choices.find((choice) => picked?.n === choice.fraction.n && picked?.d === choice.fraction.d)?.key ?? null;
            return <PortionChoices label="Your portion" totalCents={active.finalCents} choices={choices} pressed={pressed}
              custom={customChoices[active.id] ? parse(customChoices[active.id]) : null}
              customStart={customChoices[active.id] || selection[active.id] || ""} customOpen={customOpen} setCustomOpen={setCustomOpen}
              cap={room(active)} disabled={busy}
              takeLeft={activeLeft && { fraction: activeLeft, label: `Take the ${shortText(activeLeft)} left · ${money(cost(active.finalCents, activeLeft))}` }}
              onPick={(value, custom) => choose(active, custom ? text(value) : shortText(value), custom)} />;
          })()}
          {!!selection[active.id] && <Button variant="text" className="claim-remove" onClick={() => choose(active, "")}>Remove my claim</Button>}
        </div>}
      </div>
      {reviewing && (blockers.length > 0 || (opened?.id === active.id && opened.attention)) && (() => {
        const remaining = blockers.filter((blocker) => !(blocker.kind === "item" && blocker.itemId === active.id)).length;
        const here = blockers.length > remaining;
        return <div className="claim-sheet-footer">
          <span className={remaining || here ? "" : "is-clear"}>
            {remaining ? <><CircleAlert size={16} aria-hidden="true" />Confirm is locked: {plural(remaining, "other item needs", "other items need")} you</>
              : here ? <><CircleAlert size={16} aria-hidden="true" />Resolve this item to unlock Confirm</>
                : <><Check size={16} aria-hidden="true" />Nothing else needs review</>}
          </span>
          {remaining ? <Button variant="secondary" onClick={nextToReview}>Next to review<ArrowRight size={16} aria-hidden="true" /></Button>
            : !here && <Button onClick={() => showItem(null)}>Done</Button>}
        </div>;
      })()}
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
      {(review.reviewCount > 0 || review.overCount > 0) && reviewing && <div className="claim-attention-chips">
        {review.reviewCount > 0 && <button type="button" className="claim-attention-chip is-review"
          onClick={() => goTo(blockers.find((blocker) => blocker.kind === "removed" || blocker.review))}>
          <CircleAlert size={16} aria-hidden="true" />{plural(review.reviewCount, "item changed", "items changed")} — review<ArrowRight size={15} aria-hidden="true" />
        </button>}
        {review.overCount > 0 && <button type="button" className="claim-attention-chip is-over"
          onClick={() => goTo(blockers.find((blocker) => blocker.kind === "item" && blocker.over))}>
          <CircleAlert size={16} aria-hidden="true" />{plural(review.overCount, "item exceeds", "items exceed")} what's left<ArrowRight size={15} aria-hidden="true" />
        </button>}
      </div>}
      <button type="button" className="claim-summary-trigger" aria-haspopup="dialog" onClick={() => setSummary(true)}>Receipt summary</button>
      <output className="claim-share" aria-live="polite">Your share {money(share(items, selection))}</output>
      {confirmAction}
    </div>
  </>;
}

function PriceChange({ from, to }: { from: number; to: number }) {
  return <span className="claim-price-change"><s>{money(from)}</s> → <b>{money(to)}</b></span>;
}

function AttentionBadges({ attention, initiatorName }: { attention: ItemAttention; initiatorName: string }) {
  const change = attention.changed;
  return <>
    {attention.isNew && <span className="claim-attention-badge is-new"><Sparkles size={12} aria-hidden="true" />New</span>}
    {change && change.from.finalCents !== change.to.finalCents &&
      <span className="claim-attention-badge is-changed">Price <PriceChange from={change.from.finalCents} to={change.to.finalCents} /></span>}
    {change && change.from.name !== change.to.name &&
      <span className="claim-attention-badge is-changed">Renamed from “{change.from.name}”</span>}
    {change && change.from.name === change.to.name && change.from.finalCents === change.to.finalCents &&
      <span className="claim-attention-badge is-changed">Item changed — review</span>}
    {attention.invalid && <span className="claim-attention-badge is-over">Pick your portion again</span>}
    {attention.conflict && attention.over && <span className="claim-attention-badge is-over">Someone just updated this</span>}
    {attention.updated && <span className="receipt-badge">{initiatorName === "You" ? "Updated" : `Updated by ${initiatorName}`}</span>}
  </>;
}

// A picked item the initiator removed. It has no sheet, so the row itself explains and dismisses it.
function RemovedRow({ removed, dismiss }: { removed: RemovedItem; dismiss: () => void }) {
  const id = useId();
  return <div className="claim-removed-row" data-removed={removed.itemId}>
    <Trash2 size={18} aria-hidden="true" />
    <span id={id}><s>{removed.name}</s>
      <small>Removed — your {removed.portion ? `${text(removed.portion)} (${money(cost(removed.finalCents, removed.portion))})` : "pick"} was dropped</small></span>
    <Button variant="secondary" className="small" onClick={dismiss} describedBy={id}>Got it</Button>
  </div>;
}

// Why this item needs attention, at the top of its sheet.
function SheetNotices({ item, attention, mine, isNew, reviewed, initiatorName, seen }: {
  item: BillItem; attention: ItemAttention | undefined; mine: Fraction | null; isNew: boolean; reviewed: boolean;
  initiatorName: string; seen: () => void;
}) {
  const change = attention?.changed;
  return <>
    {change && <div className="claim-notice is-review" role="alert">
      <strong>{initiatorName} changed this item since you picked it</strong>
      {change.from.finalCents !== change.to.finalCents && <p>Price <PriceChange from={change.from.finalCents} to={change.to.finalCents} />.
        {mine && <> Your {text(mine)} is now <b>{money(cost(change.to.finalCents, mine))}</b> (was {money(cost(change.from.finalCents, mine))}).</>}</p>}
      {change.from.name !== change.to.name && <p>Renamed from “{change.from.name}”.</p>}
      {change.from.name === change.to.name && change.from.finalCents === change.to.finalCents &&
        <p>It was edited, but its name and price of <b>{money(change.to.finalCents)}</b> are what you saw before.</p>}
      <Button onClick={seen}>I've seen the new price</Button>
      <small>Or pick a different portion below.</small>
    </div>}
    {!change && reviewed && <p className="claim-resolved" role="status"><Check size={16} aria-hidden="true" />Reviewed. You're claiming {item.name} at its current price.</p>}
    {isNew && <div className="claim-notice is-new">
      <strong><Sparkles size={15} aria-hidden="true" />New item</strong>
      <p>{initiatorName} added this after you started. Pick a portion if some of it is yours; otherwise leave it.</p>
    </div>}
    {attention?.conflict && attention.over && <div className="claim-notice is-over" role="alert">
      <strong>Someone just updated this item — {attention.over.left.n > 0n ? `only ${shortText(attention.over.left)} left` : "nothing is left"}</strong>
      <p>Your Confirm didn't go through. Your picks are kept; lower this one to continue.</p>
    </div>}
  </>;
}
