import type { CSSProperties } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { money, type Bill } from "./bill-api";
import type { BillItem } from "./receipt-api";
import { add, claimable, cost, fraction, lessOrEqual, one, subtract, sum, text, shortText, zero, type Fraction } from "./claim-fractions";
import type { ClaimChange } from "./claim-changes";
import { avatarTint } from "./appearance";
import { Avatar } from "./ui";

// Settles in under half a second. MotionConfig at the app root turns it off for reduced motion.
const grow: Transition = { type: "spring", visualDuration: 0.45, bounce: 0.1 };

type Participant = Bill["participants"][number];

type Segment = { key: string; fraction: Fraction; tint?: string; label?: string; kind: "person" | "you" | "over"; reserved?: boolean };

const percent = (f: Fraction, scale: Fraction) => `${Number((f.n * scale.d * 1_000_000n) / (f.d * scale.n)) / 10_000}%`;

function othersOn(item: BillItem, participants: Participant[], ownId: string | undefined) {
  return participants.flatMap((person) => {
    if (person.userId === ownId) return [];
    const claims = item.claims.filter((claim) => claim.userId === person.userId);
    return claims.length ? [{ person, fraction: sum(claims), reserved: claims.some((claim) => !claim.confirmedAt) }] : [];
  });
}

/**
 * Everyone's portions of one item: a segment per claimant in their avatar colour, then this
 * participant's pick, then free space. A pick that no longer fits spills past a mark where
 * the item ends. A full item fills the bar with no trailing separator.
 */
export function PortionBar({ item, participants, ownId, mine, changes, compact = false }: {
  item: BillItem; participants: Participant[]; ownId: string | undefined; mine: Fraction | null;
  changes: ClaimChange[]; compact?: boolean;
}) {
  const others = othersOn(item, participants, ownId);
  const room = subtract(one, sum(item.claims.filter((claim) => claim.userId !== ownId)));
  const segments: Segment[] = others.map(({ person, fraction: f, reserved }) => ({
    key: person.userId, fraction: f, kind: "person", tint: avatarTint(person.displayName),
    label: person.displayName.trim().slice(0, 1).toUpperCase(), reserved,
  }));
  let total = subtract(one, room);
  if (mine) {
    const fits = lessOrEqual(mine, room);
    const inside = fits ? mine : room;
    if (inside.n > 0n) segments.push({ key: "you", fraction: inside, kind: "you", label: "You" });
    if (!fits) segments.push({ key: "over", fraction: subtract(mine, room), kind: "over", label: "!" });
    total = add(total, mine);
  }
  // An over-allocated item stretches the scale past its end, which a mark then shows.
  const scale = lessOrEqual(total, one) ? one : total;
  const overflowing = scale !== one;
  return <span className={`claim-bar${compact ? " is-compact" : ""}${overflowing ? " is-over" : ""}`}>
    <span className="claim-bar-track">
      <AnimatePresence initial={false}>
        {segments.map((segment) => {
          const change = segment.kind === "person" ? changes.find((entry) => entry.itemId === item.id && entry.userId === segment.key) : undefined;
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
    {overflowing && <motion.span className="claim-bar-edge" title="Item ends here" initial={false} animate={{ left: percent(one, scale) }} transition={grow} />}
  </span>;
}

/** Names each claimant, with the latest change beside theirs, then this participant's pick and what is free. */
export function PortionLegend({ item, participants, ownId, mine, changes }: {
  item: BillItem; participants: Participant[]; ownId: string | undefined; mine: Fraction | null; changes: ClaimChange[];
}) {
  const others = othersOn(item, participants, ownId);
  const room = subtract(one, sum(item.claims.filter((claim) => claim.userId !== ownId)));
  const free = mine ? (lessOrEqual(mine, room) ? subtract(room, mine) : zero) : room;
  const released = changes.filter((change) => change.itemId === item.id && !others.some(({ person }) => person.userId === change.userId));
  const signedText = (delta: Fraction) => delta.n > 0n ? `+${text(delta)}` : `−${text({ n: -delta.n, d: delta.d })}`;
  return <span className="claim-legend">
    {others.map(({ person, fraction: f, reserved }) => {
      const change = changes.find((entry) => entry.itemId === item.id && entry.userId === person.userId);
      return <span key={person.userId} className={`claim-legend-chip${change ? " is-lit" : ""}`} data-person={person.userId}>
        <Avatar name={person.displayName} imageUrl={person.imageUrl} fallbackImageUrl={person.fallbackImageUrl} small />
        {person.displayName} · {shortText(f)}{reserved && " reserved"}{change && <em>{signedText(change.delta)}</em>}
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
    {mine && <span className={`claim-legend-chip is-you${lessOrEqual(mine, room) ? "" : " is-over"}`}><i />You · {text(mine)}</span>}
    {free.n > 0n && <span className="claim-legend-chip is-free"><i />Free · {shortText(free)}</span>}
  </span>;
}

/** The YOUR PORTION card: the chosen portion's price, everyone's portions, and what to do if it no longer fits. */
export function ClaimPortion({ item, participants, ownId, mine, changes, over }: {
  item: BillItem; participants: Participant[]; ownId: string | undefined; mine: Fraction | null; changes: ClaimChange[];
  over: { left: Fraction; by: Fraction } | null;
}) {
  return <div className={`claim-portion${over ? " is-over" : ""}`}>
    <span className="eyebrow">YOUR PORTION</span>
    <strong className={mine ? "" : "claim-portion-empty"}>{money(mine ? cost(item.finalCents, mine) : 0)}</strong>
    <span className="claim-portion-caption">{mine ? `${text(mine)} of ${money(item.finalCents)}` : `Pick a portion of ${money(item.finalCents)}`}</span>
    <span aria-hidden="true"><PortionBar item={item} participants={participants} ownId={ownId} mine={mine} changes={changes} /></span>
    <PortionLegend item={item} participants={participants} ownId={ownId} mine={mine} changes={changes} />
    {over && mine && <p className="claim-over-text" role="alert">
      {over.left.n > 0n ? `Only ${shortText(over.left)} left. ` : "Nothing is left. "}
      Your {text(mine)} is over by {shortText(over.by)}. {over.left.n === 0n ? "Remove your claim to confirm." : claimable(over.left) ? `Pick ${shortText(over.left)} or less to confirm.` : "Pick a smaller portion to confirm."}
    </p>}
  </div>;
}
