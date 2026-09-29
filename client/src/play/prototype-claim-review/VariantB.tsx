// PROTOTYPE — Variant B "Guided review": the footer's one action becomes "Review N items",
// which opens a sheet that walks through every attention item in order (back/next,
// keep, change portion, got it). Confirm lives at the end of the walk.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Sparkles, Trash2 } from "lucide-react";
import { money } from "../bill-api";
import { cost } from "../claim-fractions";
import { AnimatedMoney } from "../AnimatedMoney";
import Dialog from "../Dialog";
import { ReceiptItemRow } from "../ReceiptItemRow";
import { Button } from "../ui";
import {
  attentionOf, counts, initiatorName, mineOf, parse, plural, shortText, text, yourShare,
  type Blocker, type Item, type Removed, type State,
} from "./model";
import { Badges, BillContext, ConflictNote, PortionCard, PortionChoices, PriceChange, ReceiptLine, RemovedRow, RowDetails, SavedNote, confirmLabel } from "./shared";
import type { VariantProps } from "./variant-props";

type Step = { key: string; itemId?: string; removed?: Removed };
const stepOf = (b: Blocker): Step => b.kind === "removed" ? { key: `removed:${b.removed.id}`, removed: b.removed } : { key: `item:${b.item.id}`, itemId: b.item.id };

export function VariantB({ state, dispatch, busy, confirm }: VariantProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [queue, setQueue] = useState<Step[] | null>(null);
  const [at, setAt] = useState(0);
  const { blockers, review, over } = counts(state);
  const openKeys = new Set(blockers.map((b) => stepOf(b).key));
  // The queue stays live: anything that starts needing attention mid-review joins the end
  // (state adjusted during render, React's recommended alternative to an effect).
  const fresh = queue ? blockers.map(stepOf).filter((s) => !queue.some((q) => q.key === s.key)) : [];
  if (queue && fresh.length) setQueue([...queue, ...fresh]);
  function startReview(key?: string) {
    const steps = blockers.map(stepOf);
    setQueue(steps);
    setAt(Math.max(0, steps.findIndex((s) => s.key === key)));
    setActiveId(null);
  }
  const rows: ReactNode[] = [];
  state.items.forEach((item, index) => {
    state.removed.filter((r) => r.index === index).forEach((r) => rows.push(<RemovedRow key={`removed-${r.id}`} removed={r} pulse={false} dismiss={() => dispatch({ type: "dismissRemoved", id: r.id })} />));
    const attention = attentionOf(state, item);
    rows.push(<motion.div key={item.id} layout="position" className={`pcr-row${attention.over ? " is-over" : attention.changed || attention.isNew ? " is-review" : ""}`}
      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
      <ReceiptItemRow item={item} mode="claim" selected={activeId === item.id} onOpen={() => { dispatch({ type: "open", id: item.id }); setActiveId(item.id); }}
        badges={<Badges attention={attention} state={state} item={item} />} secondary={<RowDetails state={state} item={item} />} />
    </motion.div>);
  });
  state.removed.filter((r) => r.index >= state.items.length).forEach((r) => rows.push(<RemovedRow key={`removed-${r.id}`} removed={r} pulse={false} dismiss={() => dispatch({ type: "dismissRemoved", id: r.id })} />));
  const active = state.items.find((i) => i.id === activeId);

  return <BillContext>
    <div className="receipt-item-list claim-list pcr-list"><AnimatePresence initial={false}>{rows}</AnimatePresence></div>
    <div className="claim-sticky-footer pcr-footer pcr-footer-b">
      {state.conflict && <ConflictNote state={state} />}
      {blockers.length > 0 && <p className="pcr-footer-summary"><CircleAlert size={16} aria-hidden="true" />
        {[review && plural(review, "item changed", "items changed"), over && plural(over, "item exceeds", "items exceed") + " what's left"].filter(Boolean).join(" · ")}. Review before confirming.</p>}
      <SavedNote state={state} />
      <span className="pcr-footer-spacer" />
      <output className="claim-share">Your share <AnimatedMoney cents={yourShare(state)} /></output>
      {blockers.length > 0
        ? <Button className="pcr-review-button" onClick={() => startReview()}>Review {plural(blockers.length, "item", "items")}<ArrowRight size={16} aria-hidden="true" /></Button>
        : <Button disabled={busy} onClick={confirm}>{busy ? "Saving…" : confirmLabel(state)}</Button>}
    </div>
    {active && <Dialog key={active.id} title={active.name} kicker="CLAIM AN ITEM" className="receipt-sheet claim-sheet pcr-sheet" closeLabel="Close claim" close={() => setActiveId(null)}>
      <div className="receipt-sheet-content">
        {openKeys.has(`item:${active.id}`) && <div className="pcr-notice is-review">
          <strong>This item needs your review</strong>
          <p>It's one of {plural(blockers.length, "item", "items")} to check before you can confirm.</p>
          <Button onClick={() => startReview(`item:${active.id}`)}>Review it step by step</Button>
        </div>}
        <PortionCard state={state} item={active} />
        <PortionChoices state={state} item={active} dispatch={dispatch} />
        <ReceiptLine item={active} />
      </div>
      <div className="pcr-sheet-footer">
        <span className={blockers.length ? "" : "is-clear"}>{blockers.length ? <><CircleAlert size={15} aria-hidden="true" />{plural(blockers.length, "item", "items")} to review before Confirm</> : <><Check size={15} aria-hidden="true" />Nothing to review</>}</span>
        {blockers.length ? <Button variant="secondary" onClick={() => startReview()}>Review all</Button> : <Button onClick={() => setActiveId(null)}>Done</Button>}
      </div>
    </Dialog>}
    {queue && queue.length > 0 && <ReviewSheet state={state} dispatch={dispatch} queue={queue} at={Math.min(at, queue.length - 1)} setAt={setAt}
      openKeys={openKeys} busy={busy} close={() => setQueue(null)} confirm={() => { setQueue(null); confirm(); }} />}
  </BillContext>;
}

function ReviewSheet({ state, dispatch, queue, at, setAt, openKeys, busy, close, confirm }: {
  state: State; dispatch: VariantProps["dispatch"]; queue: Step[]; at: number; setAt: (n: number) => void;
  openKeys: Set<string>; busy: boolean; close: () => void; confirm: () => void;
}) {
  const step = queue[at];
  const item = step.itemId ? state.items.find((i) => i.id === step.itemId) : undefined;
  const resolved = (s: Step) => !openKeys.has(s.key);
  const remaining = queue.filter((s) => !resolved(s)).length;
  const [finished, setFinished] = useState(false);
  const done = finished && remaining === 0;
  const nextOpen = () => { const i = queue.findIndex((s, index) => index > at && !resolved(s)); return i >= 0 ? i : queue.findIndex((s) => !resolved(s)); };
  const advance = () => { if (remaining === 0) { setFinished(true); return; } const n = nextOpen(); setAt(n >= 0 && n !== at ? n : Math.min(at + 1, queue.length - 1)); };
  // Viewing a new item is what acknowledges it.
  useEffect(() => { if (step.itemId) dispatch({ type: "open", id: step.itemId }); }, [step.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Resolving the current step moves on by itself, after a beat so the change is visible.
  const isResolved = resolved(step);
  const was = useRef({ key: step.key, resolved: isResolved });
  useEffect(() => {
    const before = was.current;
    was.current = { key: step.key, resolved: isResolved };
    if (before.key !== step.key || before.resolved || !isResolved) return;
    const t = setTimeout(advance, 650);
    return () => clearTimeout(t);
  }, [isResolved, step.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = done ? "All reviewed" : step.removed ? step.removed.name : item?.name ?? "Removed item";
  return <Dialog title={title} kicker={done ? "REVIEW CHANGES" : `REVIEW CHANGES · ${at + 1} OF ${queue.length}`} className="receipt-sheet claim-sheet pcr-sheet pcr-review-sheet" closeLabel="Close review" close={close}>
    <ol className="pcr-steps" aria-label="Review progress">
      {queue.map((s, i) => <li key={s.key}><button type="button" aria-current={i === at && !done ? "step" : undefined}
        className={resolved(s) ? "is-done" : ""} aria-label={`Step ${i + 1}${resolved(s) ? ", done" : ""}`} onClick={() => setAt(i)} /></li>)}
    </ol>
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={done ? "done" : step.key} className="receipt-sheet-content" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.18 }}>
        {done ? <div className="pcr-review-done">
          <Check size={28} aria-hidden="true" />
          <p>You've checked every change. Your share is <b>{money(yourShare(state))}</b>.</p>
        </div> : step.removed ? <RemovedStep removed={step.removed} resolved={resolved(step)} dismiss={() => dispatch({ type: "dismissRemoved", id: step.removed!.id })} />
          : item ? <ItemStep state={state} item={item} dispatch={dispatch} resolved={resolved(step)} />
            : <p className="receipt-field-help">{initiatorName} removed this item while you were reviewing.</p>}
      </motion.div>
    </AnimatePresence>
    <div className="pcr-sheet-footer pcr-step-nav">
      <Button variant="secondary" disabled={at === 0 || done} onClick={() => setAt(at - 1)}><ArrowLeft size={16} aria-hidden="true" />Back</Button>
      <span>{done ? "Ready to confirm" : `${remaining} left`}</span>
      {done ? <Button disabled={busy} onClick={confirm}>{confirmLabel(state)}</Button>
        : <Button variant={isResolved ? "primary" : "secondary"} onClick={advance}>Next<ArrowRight size={16} aria-hidden="true" /></Button>}
    </div>
  </Dialog>;
}

function RemovedStep({ removed, resolved, dismiss }: { removed: Removed; resolved: boolean; dismiss: () => void }) {
  const portion = parse(removed.portion)!;
  return <div className="pcr-step">
    <div className="pcr-step-what is-removed"><Trash2 size={20} aria-hidden="true" /><div>
      <strong>{initiatorName} removed this item</strong>
      <p>Your {removed.portion} ({money(cost(removed.finalCents, portion))}) was dropped from your share.</p></div></div>
    {resolved ? <p className="pcr-resolved"><Check size={16} aria-hidden="true" />Noted.</p> : <Button onClick={dismiss}>Got it</Button>}
  </div>;
}

function ItemStep({ state, item, dispatch, resolved }: { state: State; item: Item; dispatch: VariantProps["dispatch"]; resolved: boolean }) {
  const attention = attentionOf(state, item);
  const [openedWith] = useState(attention);
  const [changing, setChanging] = useState(!!openedWith.over || openedWith.isNew);
  const mine = mineOf(state, item.id);
  const change = attention.changed ?? openedWith.changed;
  return <div className="pcr-step">
    {change && <div className="pcr-step-what is-changed"><CircleAlert size={20} aria-hidden="true" /><div>
      <strong>{initiatorName} changed {change.from.finalCents !== change.to.finalCents ? "the price" : "the name"}</strong>
      {change.from.finalCents !== change.to.finalCents && <dl className="pcr-diff">
        <div><dt>Item</dt><dd><PriceChange from={change.from.finalCents} to={change.to.finalCents} /></dd></div>
        {mine && <div><dt>Your {text(mine)}</dt><dd><PriceChange from={cost(change.from.finalCents, mine)} to={cost(change.to.finalCents, mine)} /></dd></div>}
      </dl>}
      {change.from.name !== change.to.name && <p>Was “{change.from.name}”.</p>}
    </div></div>}
    {openedWith.isNew && <div className="pcr-step-what is-new"><Sparkles size={20} aria-hidden="true" /><div>
      <strong>{initiatorName} added this item</strong><p>Pick a portion if some of it is yours. Otherwise just move on.</p></div></div>}
    {attention.over && !attention.over.conflict && <div className="pcr-step-what is-over"><CircleAlert size={20} aria-hidden="true" /><div>
      <strong>Someone else claimed more — only {shortText(attention.over.left)} left</strong><p>Your {text(mine!)} no longer fits. Lower it or remove it to continue.</p></div></div>}
    {attention.over?.conflict && <div className="pcr-step-what is-over"><CircleAlert size={20} aria-hidden="true" /><div>
      <strong>Someone just updated this item — only {shortText(attention.over.left)} left</strong><p>Your Confirm didn't go through. Lower your portion to continue.</p></div></div>}
    <PortionCard state={state} item={item} />
    {attention.changed && mine && !changing && <div className="pcr-step-actions">
      <Button onClick={() => dispatch({ type: "ack", id: item.id })}>Keep {text(mine)} at {money(cost(item.finalCents, mine))}</Button>
      <Button variant="secondary" onClick={() => setChanging(true)}>Change portion</Button>
    </div>}
    {(changing || !attention.changed) && <PortionChoices state={state} item={item} dispatch={dispatch} />}
    {resolved && <p className="pcr-resolved"><Check size={16} aria-hidden="true" />Done{attention.over ? "" : ` — ${mine ? `you're claiming ${text(mine)}` : "not claiming this"}`}.</p>}
  </div>;
}
