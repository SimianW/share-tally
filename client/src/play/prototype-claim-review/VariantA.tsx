// PROTOTYPE — Variant A "Inline badges": attention lives on the rows themselves; a footer
// chip jumps to the next item, and each item is acknowledged inside its own sheet.
import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, CircleAlert, Sparkles } from "lucide-react";
import { money } from "../bill-api";
import { cost } from "../claim-fractions";
import { AnimatedMoney } from "../AnimatedMoney";
import Dialog from "../Dialog";
import { ReceiptItemRow } from "../ReceiptItemRow";
import { Button } from "../ui";
import {
  attentionOf, counts, initiatorName, mineOf, plural, shortText, text, yourShare, freeAfterMine,
  type Blocker, type Item, type ItemAttention, type State,
} from "./model";
import { Badges, BillContext, ConflictNote, PortionCard, PortionChoices, PriceChange, ReceiptLine, RemovedRow, RowDetails, SavedNote, confirmLabel } from "./shared";
import type { VariantProps } from "./variant-props";

const firstOf = (blockers: Blocker[], want: "review" | "over") => blockers.find((b) =>
  want === "over" ? b.kind === "item" && !!b.attention.over : b.kind === "removed" || b.attention.isNew || !!b.attention.changed);

export function VariantA({ state, dispatch, busy, confirm }: VariantProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pulse, setPulse] = useState<string | null>(null);
  const { blockers, review, over } = counts(state);
  const active = state.items.find((i) => i.id === activeId);
  function open(id: string) { dispatch({ type: "open", id }); setActiveId(id); }
  function jump(blocker: Blocker | undefined) {
    if (!blocker) return;
    if (blocker.kind === "item") return open(blocker.item.id);
    // Removed items have no sheet; bring their notice into view instead.
    setActiveId(null);
    setPulse(blocker.removed.id);
    document.querySelector(`[data-removed="${blocker.removed.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => setPulse(null), 1200);
  }
  const rows: ReactNode[] = [];
  state.items.forEach((item, index) => {
    state.removed.filter((r) => r.index === index).forEach((r) => rows.push(<RemovedRow key={`removed-${r.id}`} removed={r} pulse={pulse === r.id} dismiss={() => dispatch({ type: "dismissRemoved", id: r.id })} />));
    rows.push(<ItemRow key={item.id} state={state} item={item} active={activeId === item.id} open={() => open(item.id)} />);
  });
  state.removed.filter((r) => r.index >= state.items.length).forEach((r) => rows.push(<RemovedRow key={`removed-${r.id}`} removed={r} pulse={pulse === r.id} dismiss={() => dispatch({ type: "dismissRemoved", id: r.id })} />));

  return <BillContext>
    <div className="receipt-item-list claim-list pcr-list"><AnimatePresence initial={false}>{rows}</AnimatePresence></div>
    <div className="claim-sticky-footer pcr-footer">
      {state.conflict && <ConflictNote state={state} />}
      <AttentionChips review={review} over={over} onReview={() => jump(firstOf(blockers, "review"))} onOver={() => jump(firstOf(blockers, "over"))} />
      <SavedNote state={state} />
      <span className="pcr-footer-spacer" />
      <output className="claim-share">Your share <AnimatedMoney cents={yourShare(state)} /></output>
      <Button disabled={busy || blockers.length > 0} onClick={confirm}>{busy ? "Saving…" : confirmLabel(state)}</Button>
    </div>
    {active && <Dialog key={active.id} title={active.name} kicker="CLAIM AN ITEM" className="receipt-sheet claim-sheet pcr-sheet" closeLabel="Close claim" close={() => setActiveId(null)}>
      <SheetA state={state} item={active} dispatch={dispatch}
        next={() => { const rest = blockers.filter((b) => b.kind !== "item" || b.item.id !== active.id); jump(rest[0]); }}
        remaining={blockers.filter((b) => b.kind !== "item" || b.item.id !== active.id).length} close={() => setActiveId(null)} />
    </Dialog>}
  </BillContext>;
}

function AttentionChips({ review, over, onReview, onOver }: { review: number; over: number; onReview: () => void; onOver: () => void }) {
  if (!review && !over) return null;
  return <div className="pcr-chips">
    {review > 0 && <button type="button" className="pcr-attn-chip is-review" onClick={onReview}>
      <CircleAlert size={16} aria-hidden="true" />{plural(review, "item changed", "items changed")} — review<ArrowRight size={15} aria-hidden="true" /></button>}
    {over > 0 && <button type="button" className="pcr-attn-chip is-over" onClick={onOver}>
      <CircleAlert size={16} aria-hidden="true" />{plural(over, "item exceeds", "items exceed")} what's left<ArrowRight size={15} aria-hidden="true" /></button>}
  </div>;
}

function ItemRow({ state, item, active, open }: { state: State; item: Item; active: boolean; open: () => void }) {
  const attention = attentionOf(state, item);
  const tone = attention.over ? " is-over" : attention.changed || attention.isNew ? " is-review" : "";
  return <motion.div className={`pcr-row${tone}`} layout="position" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
    <ReceiptItemRow item={item} mode="claim" selected={active} onOpen={open} accessibleLabel={`View ${item.name} · ${money(item.finalCents)}`}
      badges={<Badges attention={attention} state={state} item={item} />}
      secondary={<RowDetails state={state} item={item} />} />
  </motion.div>;
}

function SheetA({ state, item, dispatch, next, remaining, close }: {
  state: State; item: Item; dispatch: VariantProps["dispatch"]; next: () => void; remaining: number; close: () => void;
}) {
  const attention = attentionOf(state, item);
  // Remember why the sheet was opened, so a resolved notice turns into a receipt instead of vanishing.
  const [openedWith] = useState(attention);
  const mine = mineOf(state, item.id);
  return <>
    <div className="receipt-sheet-content">
      {(openedWith.changed || attention.changed) && (() => {
        const change = attention.changed ?? openedWith.changed!;
        if (!attention.changed) return <p className="pcr-resolved"><Check size={16} aria-hidden="true" />Reviewed. You're claiming at the current price.</p>;
        return <div className="pcr-notice is-review" role="alert">
          <strong>{initiatorName} changed this item since you picked it</strong>
          {change.from.finalCents !== change.to.finalCents && <p>Price <PriceChange from={change.from.finalCents} to={change.to.finalCents} />.
            {mine && <> Your {text(mine)} is now <b>{money(cost(change.to.finalCents, mine))}</b> (was {money(cost(change.from.finalCents, mine))}).</>}</p>}
          {change.from.name !== change.to.name && <p>Renamed from “{change.from.name}”.</p>}
          <Button onClick={() => dispatch({ type: "ack", id: item.id })}>I've seen the new price</Button>
          <small>Or pick a different portion below.</small>
        </div>;
      })()}
      {openedWith.isNew && <div className="pcr-notice is-new"><strong><Sparkles size={15} aria-hidden="true" /> New item</strong>
        <p>{initiatorName} added this after you started. Pick a portion if some of it is yours; otherwise leave it.</p></div>}
      {attention.over?.conflict && <div className="pcr-notice is-over" role="alert"><strong>Someone just updated this item — only {shortText(attention.over.left)} left</strong>
        <p>Your Confirm didn't go through. Your picks are kept; lower this one to continue.</p></div>}
      <PortionCard state={state} item={item} />
      <PortionChoices state={state} item={item} dispatch={dispatch} />
      <ReceiptLine item={item} />
      {!attention.over && <p className="receipt-field-help">{shortText(freeAfterMine(state, item))} free after your pick. Your choices aren't submitted until you confirm.</p>}
    </div>
    <div className="pcr-sheet-footer">
      <span className={remaining > 0 || blockingHere(attention) ? "" : "is-clear"}>{remaining > 0 ? <><CircleAlert size={15} aria-hidden="true" />Confirm is locked: {plural(remaining, "other item needs", "other items need")} you</> : blockingHere(attention) ? <><CircleAlert size={15} aria-hidden="true" />Resolve this item to unlock Confirm</> : <><Check size={15} aria-hidden="true" />Nothing else needs review</>}</span>
      {remaining > 0 ? <Button variant="secondary" onClick={next}>Next<ArrowRight size={16} aria-hidden="true" /></Button> : <Button onClick={close}>Done</Button>}
    </div>
  </>;
}
const blockingHere = (a: ItemAttention) => a.isNew || !!a.changed || !!a.over;
