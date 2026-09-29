/* eslint-disable react-refresh/only-export-components, react-hooks/purity -- throwaway prototype */
// PROTOTYPE — throwaway. Pieces every variant shares: the per-person portion bar,
// the compact row meter, the portion picker and the bill page context.
import { useState, type CSSProperties, type ReactNode, type Dispatch } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, Sparkles, Trash2 } from "lucide-react";
import { money } from "../bill-api";
import { cost } from "../claim-fractions";
import { AnimatedMoney } from "../AnimatedMoney";
import { Button } from "../ui";
import {
  attentionOf, freeAfterMine, mineOf, one, othersOf, parse, people, percent, plus, shortText, text, zero, room, initiatorName, isSelected,
  type Action, type Fraction, type Item, type ItemAttention, type PersonId, type Removed, type State,
} from "./model";

export function PersonDot({ id, small = true }: { id: PersonId; small?: boolean }) {
  return <span className={`avatar ${small ? "small" : ""} pcr-dot`} style={{ "--avatar-color": people[id].tint } as CSSProperties} title={people[id].name}>
    {id === "A" ? "Y" : people[id].name[0]}
  </span>;
}

export function Frac({ value }: { value: Fraction }) {
  if (value.d === 1n) return <span className="claim-fraction">{String(value.n)}</span>;
  return <span className="claim-fraction"><sup>{String(value.n)}</sup><span>/</span><sub>{String(value.d)}</sub></span>;
}

const fresh = (at: number | undefined) => at !== undefined && Date.now() - at < 1400;

type Segment = { key: string; person: PersonId | "over"; f: Fraction };
function segmentsOf(state: State, item: Item) {
  const others = othersOf(item);
  const mine = mineOf(state, item.id);
  const left = room(item);
  const list: Segment[] = others.map((o) => ({ key: o.person, person: o.person, f: o.f }));
  let total = others.reduce((a, o) => plus(a, o.f), zero);
  if (mine) {
    const fits = mine.n * left.d <= left.n * mine.d;
    const inside = fits ? mine : left;
    if (inside.n > 0n) list.push({ key: "A", person: "A", f: inside });
    if (!fits) list.push({ key: "over", person: "over", f: plus(mine, { n: -left.n, d: left.d }) });
    total = plus(total, mine);
  }
  // Over-allocation stretches the scale past 100%; a marker shows where the item ends.
  const scale = total.n * one.d > one.n * total.d ? total : one;
  return { list, scale };
}
const widthOf = (f: Fraction, scale: Fraction) => `${percent({ n: f.n * scale.d, d: f.d * scale.n })}%`;

/** The per-person bar. Each other participant is a coloured segment that grows, shrinks and flashes live. */
export function PortionBar({ state, item, compact = false }: { state: State; item: Item; compact?: boolean }) {
  const { list, scale } = segmentsOf(state, item);
  const flash = state.flash[item.id];
  const overflowing = scale !== one;
  return <div className={`pcr-bar${compact ? " is-compact" : ""}${overflowing ? " is-over" : ""}`} aria-hidden="true">
    <div className="pcr-bar-track">
      <AnimatePresence initial={false}>
        {list.map((segment) => {
          const pct = percent({ n: segment.f.n * scale.d, d: segment.f.d * scale.n });
          return <motion.span key={segment.key} className={`pcr-seg pcr-seg-${segment.person}`}
            style={{ "--seg-tint": segment.person === "over" ? undefined : people[segment.person].tint } as CSSProperties}
            initial={{ width: 0 }} animate={{ width: widthOf(segment.f, scale) }} exit={{ width: 0 }}
            transition={{ type: "spring", stiffness: 170, damping: 24 }}>
            {!compact && pct >= 9 && <b>{segment.person === "over" ? "!" : segment.person === "A" ? "You" : people[segment.person].name[0]}</b>}
            {flash && flash.person === segment.person && fresh(flash.at) && <i key={flash.at} className="pcr-flash" />}
          </motion.span>;
        })}
      </AnimatePresence>
    </div>
    {overflowing && <motion.span className="pcr-bar-edge" initial={false} animate={{ left: widthOf(one, scale) }} />}
  </div>;
}

export function PortionLegend({ state, item }: { state: State; item: Item }) {
  const flash = state.flash[item.id];
  const mine = mineOf(state, item.id);
  const free = freeAfterMine(state, item);
  const over = attentionOf(state, item).over;
  return <div className="pcr-legend">
    {othersOf(item).map((o) => {
      const lit = flash?.person === o.person && fresh(flash.at);
      return <span key={o.person + (lit ? flash!.at : "")} className={`pcr-chip${lit ? " is-lit" : ""}`}>
        <PersonDot id={o.person} />{people[o.person].name} · {shortText(o.f)}{lit && <em>{flash!.delta}</em>}
      </span>;
    })}
    {flash && fresh(flash.at) && !othersOf(item).some((o) => o.person === flash.person) &&
      <span key={flash.at} className="pcr-chip is-lit is-gone"><PersonDot id={flash.person} />{people[flash.person].name} released {flash.delta.replace("−", "")}</span>}
    {mine && <span className={`pcr-chip is-you${over ? " is-over" : ""}`}><PersonDot id="A" />You · {text(mine)}</span>}
    {free.n > 0n && <span className="pcr-chip is-free"><i />Free · {shortText(free)}</span>}
  </div>;
}

/** The YOUR PORTION card, now with per-person segments and an over-allocation state. */
export function PortionCard({ state, item }: { state: State; item: Item }) {
  const mine = mineOf(state, item.id);
  const over = attentionOf(state, item).over;
  return <div className={`claim-portion pcr-portion${over ? " is-over" : ""}`}>
    <span className="eyebrow">YOUR PORTION</span>
    <strong className={mine ? "" : "claim-portion-empty"}><AnimatedMoney cents={mine ? cost(item.finalCents, mine) : 0} /></strong>
    <span className="claim-portion-caption">{mine ? <>{text(mine)} of <AnimatedMoney cents={item.finalCents} /></> : <>Pick a portion of <AnimatedMoney cents={item.finalCents} /></>}</span>
    <PortionBar state={state} item={item} />
    <PortionLegend state={state} item={item} />
    {over && <p className="pcr-over-text" role="alert">
      {over.left.n > 0n ? <>Only {shortText(over.left)} left. </> : <>Nothing left. </>}
      Your {text(mine!)} is over by {text(over.by)}. {over.left.n > 0n ? `Pick ${shortText(over.left)} or less to confirm.` : "Remove your claim to confirm."}
    </p>}
  </div>;
}

const presets = [["1", "All"], ["1/2", "1/2"], ["1/3", "1/3"], ["1/4", "1/4"], ["1/5", "1/5"], ["1/6", "1/6"]] as const;
/** Preset fractions plus custom; presets that no longer fit are disabled. */
export function PortionChoices({ state, item, dispatch }: { state: State; item: Item; dispatch: Dispatch<Action> }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [error, setError] = useState("");
  const mine = mineOf(state, item.id);
  const left = room(item);
  const over = attentionOf(state, item).over;
  const choose = (value: string) => { dispatch({ type: "choose", id: item.id, value }); setCustomOpen(false); setError(""); };
  const presetMatch = presets.some(([v]) => { const f = parse(v)!; return mine && f.n === mine.n && f.d === mine.d; });
  return <div className="claim-options">
    <div className="claim-portion-choices" role="group" aria-label="Your portion">
      {presets.map(([value, label]) => {
        const f = parse(value)!;
        return <button type="button" key={value} aria-pressed={!!mine && f.n === mine.n && f.d === mine.d}
          className={mine && f.n === mine.n && f.d === mine.d && over ? "pcr-pressed-over" : ""}
          disabled={f.n * left.d > left.n * f.d} onClick={() => choose(value)}>
          <b>{label === "All" ? "All" : <Frac value={f} />}</b><small>{money(cost(item.finalCents, f))}</small>
        </button>;
      })}
      <button type="button" className="claim-portion-custom" aria-pressed={!!mine && !presetMatch} disabled={left.n <= 0n}
        onClick={() => { setCustomOpen(true); setCustomText(mine ? text(mine) : ""); }}>
        <b>{mine && !presetMatch ? <Frac value={mine} /> : "…"}</b><small>{mine && !presetMatch ? money(cost(item.finalCents, mine)) : "Custom"}</small>
      </button>
    </div>
    {over && over.left.n > 0n && <div className="pcr-quick-fix">
      <Button variant="secondary" onClick={() => choose(text(over.left))}>Take the {shortText(over.left)} left · {money(cost(item.finalCents, over.left))}</Button>
    </div>}
    {customOpen && <div className="claim-custom"><label>Custom fraction<input autoFocus placeholder="4/5" value={customText} onChange={(e) => setCustomText(e.target.value)} /></label>
      <Button onClick={() => {
        const f = parse(customText);
        if (!f) return setError("Use a positive fraction up to 1.");
        if (f.n * left.d > left.n * f.d) return setError(`Only ${text(left)} is available to you.`);
        choose(text(f));
      }}>Use custom fraction</Button>{error && <p role="alert">{error}</p>}</div>}
    {mine && <Button variant="text" className="claim-remove" onClick={() => choose("")}>Remove my claim</Button>}
  </div>;
}

export function ReceiptLine({ item }: { item: Item }) {
  return <div className="receipt-original-text"><span className="eyebrow">ON THE RECEIPT</span><p>{item.originalText}</p></div>;
}

/** The compact meter and "left" text under a list row. */
export function RowDetails({ state, item }: { state: State; item: Item }) {
  const mine = mineOf(state, item.id);
  const over = attentionOf(state, item).over;
  const left = freeAfterMine(state, item);
  const everyone = othersOf(item).map((o) => o.person);
  return <span className="claim-row-details">
    <span className="claim-avatars">{everyone.map((p) => <PersonDot key={p} id={p} />)}</span>
    <PortionBar state={state} item={item} compact />
    {over ? <span className="pcr-left is-over">Over by {text(over.by)}</span> : <span className="claim-left">{shortText(left)} left</span>}
    {mine && <strong className="claim-mine">You {text(mine)}{state.saved[item.id] === state.draft[item.id] ? "" : " · not submitted"}</strong>}
  </span>;
}

export function PriceChange({ from, to }: { from: number; to: number }) {
  return <span className="pcr-price-change"><s>{money(from)}</s> → <b>{money(to)}</b></span>;
}

/** Stand-in for the bill page around the items section, so variants aren't judged in a vacuum. */
export function BillContext({ children }: { children: ReactNode }) {
  return <div className="pcr-page">
    <header className="pcr-bill-header">
      <span className="eyebrow">NO FRILLS · SAT, SEP 27 · PAID BY DEV</span>
      <h1>Weekend groceries</h1>
      <div className="pcr-bill-meta">
        <span className="avatar-stack">{(["A", "B", "C", "D"] as const).map((p) => <PersonDot key={p} id={p} />)}</span>
        <span>4 participants · 1 of 4 confirmed</span>
      </div>
    </header>
    <section className="item-claims">
      <h2 className="pcr-section-title">Items & claims</h2>
      {children}
    </section>
  </div>;
}

export const confirmLabel = (state: State) => Object.values(state.draft).some(Boolean) ? "Confirm my item claims" : "Confirm I purchased nothing";

export function SavedNote({ state }: { state: State }) {
  if (!state.savedAt || Date.now() - state.savedAt > 4000) return null;
  return <p className="pcr-saved" role="status">Claims confirmed.</p>;
}

export function ConflictNote({ state }: { state: State }) {
  const item = state.items.find((i) => i.id === state.conflict?.itemId);
  const over = item && attentionOf(state, item).over;
  if (!item || !over) return null;
  return <p className="pcr-conflict" role="alert"><CircleAlert size={16} aria-hidden="true" />Not saved. Someone just updated {item.name} — only {shortText(over.left)} left. Your other picks are kept.</p>;
}

export function Badges({ attention, state, item }: { attention: ItemAttention; state: State; item: Item }) {
  return <>
    {attention.isNew && <span className="pcr-badge is-new"><Sparkles size={12} aria-hidden="true" />New</span>}
    {attention.changed && attention.changed.from.finalCents !== attention.changed.to.finalCents &&
      <span className="pcr-badge is-changed">Price <PriceChange from={attention.changed.from.finalCents} to={attention.changed.to.finalCents} /></span>}
    {attention.changed && attention.changed.from.name !== attention.changed.to.name &&
      <span className="pcr-badge is-changed">Renamed from “{attention.changed.from.name}”</span>}
    {attention.quiet && <span className="receipt-badge">Updated by {initiatorName}</span>}
    {attention.over?.conflict && <span className="pcr-badge is-over">Someone just updated this</span>}
    {!attention.changed && !attention.isNew && isSelected(state, item.id) && state.saved[item.id] && state.saved[item.id] === state.draft[item.id] && <span className="receipt-badge">Your claim</span>}
  </>;
}

export function RemovedRow({ removed, pulse, dismiss }: { removed: Removed; pulse: boolean; dismiss: () => void }) {
  return <motion.div className={`pcr-row pcr-removed${pulse ? " is-pulse" : ""}`} data-removed={removed.id} layout="position"
    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
    <Trash2 size={18} aria-hidden="true" />
    <span><s>{removed.name}</s><small>Removed — your {removed.portion} ({money(cost(removed.finalCents, parse(removed.portion)!))}) was dropped</small></span>
    <Button variant="secondary" className="small" onClick={dismiss}>Got it</Button>
  </motion.div>;
}

