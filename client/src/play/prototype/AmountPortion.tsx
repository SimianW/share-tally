// PROTOTYPE for #150 — throwaway, do not ship.
// Plan: three variants of the By amount share picker, switchable via ?variant=A|B|C.
// A generalised copy of the By item card (ClaimPortion, PortionBar, PortionLegend) and its
// choice buttons, measuring portions of a money total instead of fractions of an item.
import { useId, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { Pencil } from "lucide-react";
import { money } from "../bill-api";
import { cost, parse, type Fraction } from "../claim-fractions";
import { avatarTint } from "../appearance";
import { Avatar, Button } from "../ui";
import { SegmentedControl } from "../SegmentedControl";
import { amountText, choicesFor, fractionLabel, isAll, parseCents, pressedChoice, tally, type Other, type Pressed } from "./amount-portion";

export type Variant = "A" | "B" | "C";

// Same spring as the By item bar.
const grow: Transition = { type: "spring", visualDuration: 0.45, bounce: 0.1 };

// A local copy of ClaimItems' internal FractionText, so the buttons read the same.
export function FractionText({ value }: { value: Fraction }) {
  return <span className="claim-fraction"><sup>{String(value.n)}</sup><span>/</span><sub>{String(value.d)}</sub></span>;
}

const pct = (cents: number, scale: number) => `${scale > 0 ? (cents / scale) * 100 : 0}%`;

/** Everyone's submitted amounts as segments, then yours, then free; past the total it spills. */
function AmountBar({ totalCents, others, mineCents }: { totalCents: number | null; others: Other[]; mineCents: number | null }) {
  const total = totalCents ?? 0;
  const { othersSum } = tally(totalCents, others, mineCents);
  const mine = mineCents ?? 0;
  const room = Math.max(0, total - othersSum);
  const inside = Math.min(mine, room);
  const spill = mine - inside;
  const scale = Math.max(total, othersSum + mine);
  const overflowing = totalCents !== null && scale > total;
  const segments = [
    ...others.filter((other) => (other.cents ?? 0) > 0).map((other) => ({
      key: other.person.id, cents: other.cents!, kind: "person", tint: avatarTint(other.person.displayName),
      label: other.person.displayName.trim().slice(0, 1).toUpperCase(),
    })),
    ...(inside > 0 ? [{ key: "you", cents: inside, kind: "you", tint: undefined, label: "You" }] : []),
    ...(spill > 0 ? [{ key: "over", cents: spill, kind: "over", tint: undefined, label: "!" }] : []),
  ];
  return <span className={`claim-bar${overflowing ? " is-over" : ""}`}>
    <span className="claim-bar-track">
      <AnimatePresence initial={false}>
        {scale > 0 && segments.map((segment) => <motion.span key={segment.key} data-segment={segment.key}
          className={`claim-bar-segment is-${segment.kind}`}
          style={segment.tint ? { "--segment-tint": segment.tint } as CSSProperties : undefined}
          initial={{ width: 0 }} animate={{ width: pct(segment.cents, scale) }} exit={{ width: 0 }} transition={grow}>
          {segment.cents / scale >= 0.1 && <b>{segment.label}</b>}
        </motion.span>)}
      </AnimatePresence>
    </span>
    {overflowing && <motion.span className="claim-bar-edge" title="Total ends here" initial={false} animate={{ left: pct(total, scale) }} transition={grow} />}
  </span>;
}

/** Money, not fractions: each person's submitted amount (or "not yet"), yours, and what is free. */
function AmountLegend({ totalCents, others, mineCents, showPending }: { totalCents: number | null; others: Other[]; mineCents: number | null; showPending: boolean }) {
  const { free, over } = tally(totalCents, others, mineCents);
  return <span className="claim-legend">
    {others.filter((other) => other.cents !== null || showPending).map(({ person, cents }) =>
      <span key={person.id} className={`claim-legend-chip${cents === null ? " amount-legend-pending" : ""}`} data-person={person.id}>
        <Avatar name={person.displayName} imageUrl={person.imageUrl} small />
        {person.displayName} · {cents === null ? "not yet" : money(cents)}
      </span>)}
    {mineCents !== null && <span className={`claim-legend-chip is-you${over > 0 && mineCents > 0 ? " is-over" : ""}`}><i />You · {money(mineCents)}</span>}
    {totalCents !== null && free > 0 && <span className="claim-legend-chip is-free"><i />Free · {money(free)}</span>}
  </span>;
}

export function AmountPortion({
  variant, totalCents, count, others, showPending = true, text, onType, onPick, custom, setCustom,
  readOnly = false, noTotalHint = "Enter the total paid to pick a portion", fieldLabel = "Your share · CAD", inputId,
}: {
  variant: Variant;
  totalCents: number | null;
  /** Participants on the bill, N in Even · 1/N. */
  count: number;
  others: Other[];
  /** List people who have not submitted as "not yet" chips. */
  showPending?: boolean;
  /** The amount as typed; its parsed cents drive everything else. */
  text: string;
  onType: (text: string) => void;
  /** A button set the amount; `choice` says which portion, if any. */
  onPick: (cents: number, choice: Pressed | null) => void;
  /** The last custom fraction used, remembered like By item's per-item custom choice. */
  custom: Fraction | null;
  setCustom: (f: Fraction) => void;
  /** Completed or canceled: the card only reports. */
  readOnly?: boolean;
  noTotalHint?: string;
  fieldLabel?: string;
  inputId?: string;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customMode, setCustomMode] = useState<"fraction" | "amount">("fraction");
  const [customText, setCustomText] = useState("");
  const [customError, setCustomError] = useState("");
  const captionId = useId();
  const mine = parseCents(text);
  const invalid = !!text.trim() && mine === null;
  const choices = choicesFor(count);
  const pressed = pressedChoice(choices, totalCents, mine, custom);
  const { othersSum, left, over } = tally(totalCents, others, mine);
  const tooMuch = totalCents !== null && mine !== null && mine > totalCents;
  const noTotal = totalCents === null;
  const lit = (key: string) => !customOpen && pressed?.key === key;
  // Variant C has no amount field, so an amount that matches no portion lands in the Custom button.
  const exact = variant === "C" && mine !== null && !pressed;

  function pick(cents: number, choice: Pressed | null) {
    onPick(cents, choice);
    setCustomOpen(false);
    setCustomError("");
  }
  function saveCustomFraction() {
    const f = parse(customText);
    if (!f || totalCents === null) { setCustomError("Use a positive fraction up to 1, with numerator and denominator at most 10,000."); return; }
    setCustom(f);
    pick(cost(totalCents, f), { key: "custom", fraction: f, even: false });
  }
  function saveExactAmount() {
    const cents = parseCents(customText);
    if (cents === null) { setCustomError("Enter a valid CAD amount, with at most two decimals."); return; }
    pick(cents, null);
  }
  const enter = (save: () => void) => (event: KeyboardEvent) => {
    if (event.key === "Enter") { event.preventDefault(); save(); }
  };
  const tidy = () => { if (mine !== null) onType(amountText(mine)); };

  const caption = totalCents === null ? "No total paid yet"
    : mine === null ? `Pick a portion of ${money(totalCents)}${variant === "C" ? "" : " or type an amount"}`
      : pressed ? `${fractionLabel(pressed.fraction)} of ${money(totalCents)}`
        : `of ${money(totalCents)} total`;

  const figure = variant === "A" && !readOnly
    ? <label className="amount-figure" data-invalid={invalid || tooMuch || undefined}>
      <span className="sr-only">{fieldLabel}</span>
      <span className="amount-figure-currency" aria-hidden="true">$</span>
      <input id={inputId} className="amount-figure-input" inputMode="decimal" autoComplete="off" placeholder="0.00"
        size={Math.max(4, text.length)} value={text} aria-invalid={invalid || tooMuch} aria-describedby={captionId}
        onChange={(event) => onType(event.target.value)} onBlur={tidy} />
      <Pencil className="amount-figure-edit" size={18} aria-hidden="true" />
    </label>
    : <strong className={mine === null ? "claim-portion-empty" : ""}>{money(mine ?? 0)}</strong>;

  const customCents = custom && totalCents !== null ? cost(totalCents, custom) : null;
  const showExact = exact && !(custom && customCents === mine);
  const customLabel = showExact ? `Custom · exact amount · ${money(mine!)}`
    : custom && customCents !== null ? `Custom · ${fractionLabel(custom)} · ${money(customCents)}` : "Custom";

  return <div className="amount-portion claim-options">
    {variant === "B" && !readOnly && <label className="amount-field">
      {fieldLabel}
      <input id={inputId} inputMode="decimal" autoComplete="off" value={text} aria-invalid={invalid || tooMuch}
        aria-describedby={captionId} onChange={(event) => onType(event.target.value)} onBlur={tidy} />
    </label>}
    <div className={`claim-portion${tooMuch ? " is-over" : over > 0 ? " is-warn" : ""}`}>
      <span className="eyebrow">YOUR SHARE</span>
      {figure}
      <span className="claim-portion-caption" id={captionId}>{caption}</span>
      <span aria-hidden="true"><AmountBar totalCents={totalCents} others={others} mineCents={mine} /></span>
      <AmountLegend totalCents={totalCents} others={others} mineCents={mine} showPending={showPending} />
      {tooMuch ? <p className="claim-over-text" role="alert">Your share can't be more than the total paid.</p>
        : over > 0 && <p className="amount-warn-text" role="status">
          Shares are {money(over)} over the total. The bill can't complete until someone lowers theirs.
        </p>}
      {invalid && <p className="claim-over-text" role="alert">Enter a valid CAD amount, with at most two decimals.</p>}
    </div>
    {!readOnly && <>
      <div className="claim-portion-choices" role="group" aria-label="Your share">
        {choices.map((choice) => {
          const cents = totalCents === null ? null : cost(totalCents, choice.fraction);
          const label = `${choice.even ? "Even · " : ""}${fractionLabel(choice.fraction)}${cents === null ? "" : ` · ${money(cents)}`}`;
          return <button type="button" key={choice.key} aria-label={label} aria-pressed={lit(choice.key)} disabled={noTotal}
            className={choice.even ? "amount-choice-even" : undefined}
            onClick={() => cents !== null && pick(cents, choice)}>
            {choice.even && <span className="amount-choice-tag" aria-hidden="true">Even</span>}
            <b>{isAll(choice.fraction) ? "All" : <FractionText value={choice.fraction} />}</b>
            <small>{cents === null ? "—" : money(cents)}</small>
          </button>;
        })}
        <button type="button" className="claim-portion-custom" aria-label={customLabel} aria-expanded={customOpen}
          aria-pressed={!customOpen && (pressed?.key === "custom" || showExact)} disabled={noTotal}
          onClick={() => {
            setCustomOpen(true);
            setCustomError("");
            if (variant === "C" && showExact) { setCustomMode("amount"); setCustomText(amountText(mine!)); }
            else setCustomText(custom && customMode === "fraction" ? `${custom.n}/${custom.d}` : "");
          }}>
          {showExact ? <><b>Exact</b><small>{money(mine!)}</small></>
            : <><b>{custom ? <FractionText value={custom} /> : "…"}</b><small>{customCents !== null ? money(customCents) : "Custom"}</small></>}
        </button>
      </div>
      {noTotal && <p className="amount-hint">{noTotalHint}</p>}
      {totalCents !== null && othersSum > 0 && left > 0 && left !== mine &&
        <Button variant="secondary" className="claim-take-left" onClick={() => pick(left, null)}>Take the {money(left)} left</Button>}
      {customOpen && <div className="claim-custom">
        {variant === "C" && <SegmentedControl label="Custom by" value={customMode}
          onChange={(mode) => { setCustomMode(mode); setCustomText(""); setCustomError(""); }}
          options={[{ value: "fraction", content: "Fraction" }, { value: "amount", content: "Amount" }]} />}
        {variant === "C" && customMode === "amount"
          ? <><label>Exact amount · CAD<input autoFocus inputMode="decimal" aria-label="Exact amount · CAD" placeholder="12.50" value={customText}
            onChange={(event) => setCustomText(event.target.value)} onKeyDown={enter(saveExactAmount)} /></label>
            <Button onClick={saveExactAmount}>Use this amount</Button></>
          : <><label>Custom fraction<input autoFocus aria-label="Custom fraction" placeholder="2/5" value={customText}
            onChange={(event) => setCustomText(event.target.value)} onKeyDown={enter(saveCustomFraction)} /></label>
            <Button onClick={saveCustomFraction}>Use custom fraction</Button></>}
        {customError && <p role="alert">{customError}</p>}
      </div>}
    </>}
  </div>;
}
