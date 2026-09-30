import { useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { money, type Bill } from "./bill-api";
import { add, cost, fraction, lessOrEqual, one, parse, subtract, text, shortText, zero, type Fraction } from "./claim-fractions";
import type { ClaimChange } from "./claim-changes";
import { avatarTint } from "./appearance";
import { Avatar, Button } from "./ui";
import "./receipt-review.css";

// The portion picker is shared by the By item claim sheet and both By amount share inputs.
// Everything is a portion of one total: a bill item's final cost, or a By amount bill's total.

// Settles in under half a second. MotionConfig at the app root turns it off for reduced motion.
const grow: Transition = { type: "spring", visualDuration: 0.45, bounce: 0.1 };

type Participant = Bill["participants"][number];

/** Another participant's portion of the total. Null means they have not submitted one yet. */
export type Portion = { person: Participant; fraction: Fraction | null; reserved?: boolean };

/**
 * Where everyone stands against the total. Item claims read as fractions of an item;
 * By amount shares read as money, and are exact because each is its cents over the total.
 */
export type PortionState = {
  measure: "fraction" | "money";
  /** Null while a bill draft has no total paid yet, so nothing can be measured. */
  totalCents: number | null;
  /** Every other participant; only those with a portion get a bar segment. */
  others: Portion[];
  /** Everything the others hold, which leaves the rest of the total for this participant. */
  taken: Fraction;
  mine: Fraction | null;
  /** Recent changes to the others' portions, to flash on the bar and legend. */
  changes?: ClaimChange[];
  /** Everyone on the bill, to name a participant whose released portion is no longer shown. */
  participants?: Participant[];
};

type Segment = { key: string; fraction: Fraction; tint?: string; label?: string; kind: "person" | "you" | "over"; reserved?: boolean };

const percent = (f: Fraction, scale: Fraction) => `${Number((f.n * scale.d * 1_000_000n) / (f.d * scale.n)) / 10_000}%`;
// What is left for this participant. By amount shares can exceed the total, leaving nothing.
const roomLeft = (taken: Fraction) => lessOrEqual(taken, one) ? subtract(one, taken) : zero;

/**
 * Everyone's portions of the total: a segment per participant in their avatar colour, then this
 * participant's pick, then free space. A pick that no longer fits spills past a mark where the
 * total ends. A full total fills the bar with no trailing separator.
 */
export function PortionBar({ measure, others, taken, mine, changes = [], compact = false }: PortionState & { compact?: boolean }) {
  const room = roomLeft(taken);
  const segments: Segment[] = others.flatMap(({ person, fraction: f, reserved }) => f && f.n > 0n ? [{
    key: person.userId, fraction: f, kind: "person" as const, tint: avatarTint(person.displayName),
    label: person.displayName.trim().slice(0, 1).toUpperCase(), reserved,
  }] : []);
  let total = taken;
  if (mine) {
    const fits = lessOrEqual(mine, room);
    const inside = fits ? mine : room;
    if (inside.n > 0n) segments.push({ key: "you", fraction: inside, kind: "you", label: "You" });
    if (!fits) segments.push({ key: "over", fraction: subtract(mine, room), kind: "over", label: "!" });
    total = add(total, mine);
  }
  // An over-allocated total stretches the scale past its end, which a mark then shows.
  const scale = lessOrEqual(total, one) ? one : total;
  const overflowing = scale !== one;
  return <span className={`claim-bar${compact ? " is-compact" : ""}${overflowing ? " is-over" : ""}`}>
    <span className="claim-bar-track">
      <AnimatePresence initial={false}>
        {segments.map((segment) => {
          const change = segment.kind === "person" ? changes.find((entry) => entry.userId === segment.key) : undefined;
          return <motion.span key={segment.key} data-segment={segment.kind === "person" ? segment.key : segment.kind}
            className={`claim-bar-segment is-${segment.kind}${segment.reserved ? " is-reserved" : ""}`}
            style={segment.tint ? { "--segment-tint": segment.tint } as CSSProperties : undefined}
            initial={{ width: 0 }} animate={{ width: percent(segment.fraction, scale) }} exit={{ width: 0 }} transition={grow}>
            {!compact && lessOrEqual(fraction(1n, 10n), fraction(segment.fraction.n * scale.d, segment.fraction.d * scale.n)) && <b>{segment.label}</b>}
            {change && <i key={change.key} className="claim-bar-flash" data-flash={segment.key} />}
          </motion.span>;
        })}
      </AnimatePresence>
    </span>
    {overflowing && <motion.span className="claim-bar-edge" title={measure === "money" ? "Total ends here" : "Item ends here"}
      initial={false} animate={{ left: percent(one, scale) }} transition={grow} />}
  </span>;
}

/** Names each participant with their portion and latest change, then this participant's pick and what is free. */
export function PortionLegend({ measure, totalCents, others, taken, mine, changes = [], participants = [] }: PortionState) {
  const room = roomLeft(taken);
  const free = mine ? (lessOrEqual(mine, room) ? subtract(room, mine) : zero) : room;
  // A money portion is exact: its fraction is its cents over the total.
  const show = (f: Fraction, exact = false) => measure === "money" ? money(cost(totalCents ?? 0, f)) : exact ? text(f) : shortText(f);
  const released = changes.filter((change) => !others.some(({ person, fraction: f }) => f && person.userId === change.userId));
  const signedText = (delta: Fraction) => delta.n > 0n ? `+${text(delta)}` : `−${text({ n: -delta.n, d: delta.d })}`;
  return <span className="claim-legend">
    {others.map(({ person, fraction: f, reserved }) => {
      const change = changes.find((entry) => entry.userId === person.userId);
      return <span key={person.userId} className={`claim-legend-chip${change ? " is-lit" : ""}${f ? "" : " is-pending"}`} data-person={person.userId}>
        <Avatar name={person.displayName} imageUrl={person.imageUrl} fallbackImageUrl={person.fallbackImageUrl} small />
        {person.displayName} · {f ? show(f) : "not yet"}{reserved && " reserved"}{change && <em>{signedText(change.delta)}</em>}
      </span>;
    })}
    {released.map((change) => {
      const person = participants.find((candidate) => candidate.userId === change.userId);
      const name = person?.displayName ?? "Someone";
      return <span key={`released-${change.userId}`} className="claim-legend-chip is-lit is-gone" data-person={change.userId}>
        <Avatar name={name} imageUrl={person?.imageUrl} fallbackImageUrl={person?.fallbackImageUrl} small />
        {name} released {text({ n: -change.delta.n, d: change.delta.d })}
      </span>;
    })}
    {mine && <span className={`claim-legend-chip is-you${lessOrEqual(mine, room) ? "" : " is-over"}`}><i />You · {show(mine, true)}</span>}
    {free.n > 0n && totalCents !== null && <span className="claim-legend-chip is-free"><i />Free · {show(free)}</span>}
  </span>;
}

/**
 * The share card: a label, this participant's figure and what it is of the total, the bar and
 * legend, then any messages. An "over" tone is an error that blocks; "warn" only cautions.
 */
export function PortionCard({ label, figure, caption, captionId, tone, children, ...state }: PortionState & {
  label: string; figure: ReactNode; caption: string; captionId?: string; tone: "over" | "warn" | null; children?: ReactNode;
}) {
  return <div className={`claim-portion${tone ? ` is-${tone}` : ""}`}>
    <span className="eyebrow">{label}</span>
    {figure}
    <span className="claim-portion-caption" id={captionId}>{caption}</span>
    <span aria-hidden="true"><PortionBar {...state} /></span>
    <PortionLegend {...state} />
    {children}
  </div>;
}

/** One fixed portion choice. `name` starts its accessible label, such as "All of it" or "Even · 1/3". */
export type PortionChoice = { key: string; fraction: Fraction; name: string; tag?: string };

/**
 * The row of portion choices, then an optional "Take … left" button and the Custom fraction input.
 * A choice's price shows under its fraction; with no total yet there is no price to show.
 */
export function PortionChoices({ label, totalCents, choices, pressed, custom, customStart, customOpen, setCustomOpen, cap, disabled, takeLeft, onPick }: {
  /** Names the group of toggle buttons. */
  label: string;
  totalCents: number | null;
  choices: PortionChoice[];
  /** The pressed choice's key, "custom" for the Custom choice, or null. */
  pressed: string | null;
  /** The custom fraction last used, shown on the Custom choice. */
  custom: Fraction | null;
  /** What the Custom input starts with when opened. */
  customStart: string;
  customOpen: boolean;
  setCustomOpen: (open: boolean) => void;
  /** The most this participant may pick, or null when picks are never capped by what is left. */
  cap: Fraction | null;
  disabled: boolean;
  takeLeft?: { fraction: Fraction; label: string } | null;
  onPick: (value: Fraction, custom: boolean) => void;
}) {
  const [customText, setCustomText] = useState("");
  const [customError, setCustomError] = useState("");
  const price = (f: Fraction) => totalCents === null ? null : money(cost(totalCents, f));
  function pick(value: Fraction, isCustom: boolean) {
    onPick(value, isCustom);
    setCustomOpen(false);
  }
  function saveCustom() {
    if (disabled) return;
    const value = parse(customText);
    if (!value) { setCustomError("Use a positive fraction up to 1, with numerator and denominator at most 10,000."); return; }
    if (cap && !lessOrEqual(value, cap)) { setCustomError(`Only ${text(cap)} is available to you.`); return; }
    pick(value, true);
  }
  const customPrice = custom && price(custom);
  return <>
    <div className="claim-portion-choices" role="group" aria-label={label}>
      {choices.map((choice) => {
        const amount = price(choice.fraction);
        return <button type="button" key={choice.key} className={choice.tag ? "claim-portion-tagged" : undefined}
          aria-label={amount ? `${choice.name} · ${amount}` : choice.name}
          aria-pressed={!customOpen && pressed === choice.key}
          disabled={disabled || (!!cap && !lessOrEqual(choice.fraction, cap))} onClick={() => pick(choice.fraction, false)}>
          {choice.tag && <span className="claim-portion-tag" aria-hidden="true">{choice.tag}</span>}
          <b>{choice.fraction.n === choice.fraction.d ? "All" : <FractionText value={choice.fraction} />}</b><small>{amount ?? "—"}</small>
        </button>;
      })}
      <button type="button" className="claim-portion-custom"
        aria-label={custom ? `Custom · ${text(custom)}${customPrice ? ` · ${customPrice}` : ""}` : "Custom"}
        aria-pressed={!customOpen && pressed === "custom"} disabled={disabled || (!!cap && cap.n <= 0n)}
        onClick={() => { setCustomOpen(true); setCustomText(customStart); setCustomError(""); }}>
        <b>{custom ? <FractionText value={custom} /> : "…"}</b><small>{custom ? customPrice ?? "—" : "Custom"}</small>
      </button>
    </div>
    {takeLeft && <Button variant="secondary" className="claim-take-left" disabled={disabled} onClick={() => pick(takeLeft.fraction, false)}>
      {takeLeft.label}
    </Button>}
    {customOpen && <div className="claim-custom"><label>Custom fraction<input autoFocus aria-label="Custom fraction" placeholder="4/5" value={customText} readOnly={disabled}
      onChange={(event) => setCustomText(event.target.value)}
      // Inside a share form, Enter would otherwise submit the whole form.
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveCustom(); } }} /></label>
      <Button disabled={disabled} onClick={saveCustom}>Use custom fraction</Button>{customError && <p role="alert">{customError}</p>}</div>}
  </>;
}

// Stacked numerals render alike in every palette font; Unicode ⅕ and ⅙ fall back to another font.
export function FractionText({ value }: { value: Fraction }) {
  return <span className="claim-fraction"><sup>{String(value.n)}</sup><span>/</span><sub>{String(value.d)}</sub></span>;
}
