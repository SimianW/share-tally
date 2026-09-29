// PROTOTYPE — Variant C "Attention inbox": a pinned "Needs your attention" section above the
// list holds one compact card per changed/new/removed/over item, each resolvable in place.
// The item list below stays calm; the same card appears at the top of an item's sheet.
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Check, CircleAlert, Sparkles, Trash2 } from "lucide-react";
import { money } from "../bill-api";
import { cost } from "../claim-fractions";
import { AnimatedMoney } from "../AnimatedMoney";
import Dialog from "../Dialog";
import { ReceiptItemRow } from "../ReceiptItemRow";
import { Button } from "../ui";
import {
  attentionOf, counts, initiatorName, mineOf, parse, plural, shortText, text, yourShare,
  type Blocker, type State,
} from "./model";
import { BillContext, ConflictNote, PortionBar, PortionCard, PortionChoices, PriceChange, ReceiptLine, RowDetails, SavedNote, confirmLabel } from "./shared";
import type { VariantProps } from "./variant-props";

type Dispatch = VariantProps["dispatch"];

export function VariantC({ state, dispatch, busy, confirm }: VariantProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const inbox = useRef<HTMLElement>(null);
  const { blockers } = counts(state);
  const active = state.items.find((i) => i.id === activeId);
  const open = (id: string) => { dispatch({ type: "open", id }); setActiveId(id); };
  const activeBlocker = active && blockers.find((b) => b.kind === "item" && b.item.id === active.id);
  // In the sheet, the red portion card already explains a plain over-allocation; only a failed save needs the card.
  const sheetCard = activeBlocker?.kind === "item" && activeBlocker.attention.over && !activeBlocker.attention.over.conflict ? undefined : activeBlocker;
  return <BillContext>
    <AnimatePresence initial={false}>
      {blockers.length > 0 && <motion.section ref={inbox} className="pcr-inbox" aria-labelledby="pcr-inbox-title"
        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
        <h3 id="pcr-inbox-title">Needs your attention <span className="count">{blockers.length}</span></h3>
        <p className="pcr-inbox-help">Confirm unlocks once each of these is settled.</p>
        <div className="pcr-inbox-list">
          <AnimatePresence initial={false} mode="popLayout">
            {blockers.map((b) => <motion.div key={b.kind === "item" ? b.item.id : `removed-${b.removed.id}`} layout
              initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}>
              <AttentionCard state={state} blocker={b} dispatch={dispatch} open={open} />
            </motion.div>)}
          </AnimatePresence>
        </div>
      </motion.section>}
    </AnimatePresence>
    <div className="receipt-item-list claim-list pcr-list">
      <AnimatePresence initial={false}>
        {state.items.map((item) => {
          const attention = attentionOf(state, item);
          return <motion.div key={item.id} layout="position" className={`pcr-row${attention.over ? " is-over" : ""}`}
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <ReceiptItemRow item={item} mode="claim" selected={activeId === item.id} onOpen={() => open(item.id)}
              badges={attention.isNew || attention.changed ? <span className="pcr-badge is-marker"><ArrowUp size={12} aria-hidden="true" />{attention.isNew ? "New" : "Changed"} · see above</span> : attention.quiet ? <span className="receipt-badge">Updated by {initiatorName}</span> : null}
              secondary={<RowDetails state={state} item={item} />} />
          </motion.div>;
        })}
      </AnimatePresence>
    </div>
    <div className="claim-sticky-footer pcr-footer">
      {state.conflict && <ConflictNote state={state} />}
      {blockers.length > 0 && <button type="button" className="pcr-attn-chip is-review" onClick={() => inbox.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
        <ArrowUp size={16} aria-hidden="true" />Settle {plural(blockers.length, "item", "items")} above to confirm
</button>}
      <SavedNote state={state} />
      <span className="pcr-footer-spacer" />
      <output className="claim-share">Your share <AnimatedMoney cents={yourShare(state)} /></output>
      <Button disabled={busy || blockers.length > 0} onClick={confirm}>{busy ? "Saving…" : confirmLabel(state)}</Button>
    </div>
    {active && <Dialog key={active.id} title={active.name} kicker="CLAIM AN ITEM" className="receipt-sheet claim-sheet pcr-sheet" closeLabel="Close claim" close={() => setActiveId(null)}>
      <div className="receipt-sheet-content">
        <AnimatePresence initial={false}>
          {sheetCard && <motion.div key="card" exit={{ opacity: 0, height: 0 }}><AttentionCard state={state} blocker={sheetCard} dispatch={dispatch} open={open} inSheet /></motion.div>}
        </AnimatePresence>
        <PortionCard state={state} item={active} />
        <PortionChoices state={state} item={active} dispatch={dispatch} />
        <ReceiptLine item={active} />
      </div>
      <div className="pcr-sheet-footer">
        {(() => {
          const others = blockers.filter((b) => b !== activeBlocker).length;
          return <span className={others || activeBlocker ? "" : "is-clear"}>{others ? <><CircleAlert size={15} aria-hidden="true" />{plural(others, "other item needs", "other items need")} attention</> : activeBlocker ? <><CircleAlert size={15} aria-hidden="true" />Settle this item to unlock Confirm</> : <><Check size={15} aria-hidden="true" />Nothing needs attention</>}</span>;
        })()}
        <Button onClick={() => setActiveId(null)}>Done</Button>
      </div>
    </Dialog>}
  </BillContext>;
}

function AttentionCard({ state, blocker, dispatch, open, inSheet = false }: { state: State; blocker: Blocker; dispatch: Dispatch; open: (id: string) => void; inSheet?: boolean }) {
  if (blocker.kind === "removed") {
    const r = blocker.removed;
    return <article className="pcr-card is-removed">
      <Trash2 size={18} aria-hidden="true" />
      <div className="pcr-card-body">
        <strong><s>{r.name}</s></strong>
        <p>Removed by {initiatorName} — your {r.portion} ({money(cost(r.finalCents, parse(r.portion)!))}) was dropped.</p>
      </div>
      <div className="pcr-card-actions"><Button variant="secondary" className="small" onClick={() => dispatch({ type: "dismissRemoved", id: r.id })}>Got it</Button></div>
    </article>;
  }
  const { item, attention } = blocker;
  const mine = mineOf(state, item.id);
  const title = !inSheet && <strong>{item.name}</strong>;
  if (attention.over) {
    return <article className="pcr-card is-over">
      <CircleAlert size={18} aria-hidden="true" />
      <div className="pcr-card-body">
        {title}
        <p>{attention.over.conflict ? "Someone just updated this item — " : ""}Only {shortText(attention.over.left)} left; you picked {text(mine!)}.</p>
        {!inSheet && <PortionBar state={state} item={item} compact />}
      </div>
      <div className="pcr-card-actions">
        {attention.over.left.n > 0n && <Button className="small" onClick={() => dispatch({ type: "choose", id: item.id, value: text(attention.over!.left) })}>Take {shortText(attention.over.left)}</Button>}
        <Button variant="secondary" className="small" onClick={() => dispatch({ type: "choose", id: item.id, value: "" })}>Drop mine</Button>
        {!inSheet && <Button variant="text" className="small" onClick={() => open(item.id)}>Other portion</Button>}
      </div>
    </article>;
  }
  if (attention.isNew) {
    return <article className="pcr-card is-new">
      <Sparkles size={18} aria-hidden="true" />
      <div className="pcr-card-body">{title}<p>New · {money(item.finalCents)} · added by {initiatorName}</p></div>
      <div className="pcr-card-actions">
        {!inSheet && <Button className="small" onClick={() => open(item.id)}>Claim a portion</Button>}
        <Button variant="secondary" className="small" onClick={() => dispatch({ type: "ack", id: item.id })}>Not mine</Button>
      </div>
    </article>;
  }
  const change = attention.changed!;
  const priced = change.from.finalCents !== change.to.finalCents;
  return <article className="pcr-card is-changed">
    <CircleAlert size={18} aria-hidden="true" />
    <div className="pcr-card-body">
      {title}
      {priced && <p>Price <PriceChange from={change.from.finalCents} to={change.to.finalCents} />{mine && <> · your {text(mine)} now <b>{money(cost(change.to.finalCents, mine))}</b></>}</p>}
      {change.from.name !== change.to.name && <p>Renamed from “{change.from.name}”</p>}
    </div>
    <div className="pcr-card-actions">
      <Button className="small" onClick={() => dispatch({ type: "ack", id: item.id })}>{mine ? `Keep ${text(mine)}` : "I've seen the new price"}</Button>
      {!inSheet && <Button variant="secondary" className="small" onClick={() => open(item.id)}>Change</Button>}
    </div>
  </article>;
}
