import { money, type Bill } from "./bill-api";
import type { BillItem } from "./receipt-api";
import { claimable, cost, sum, text, shortText, type Fraction } from "./claim-fractions";
import type { ClaimChange } from "./claim-changes";
import { PortionBar, PortionCard, type PortionState } from "./PortionPicker";

type Participant = Bill["participants"][number];

/** An item's claims as portions of its final cost, with only this item's changes. */
function itemPortions(item: BillItem, participants: Participant[], ownId: string | undefined, mine: Fraction | null, changes: ClaimChange[]): PortionState {
  const others = participants.flatMap((person) => {
    if (person.userId === ownId) return [];
    const claims = item.claims.filter((claim) => claim.userId === person.userId);
    return claims.length ? [{ person, fraction: sum(claims), reserved: claims.some((claim) => !claim.confirmedAt) }] : [];
  });
  return {
    measure: "fraction", totalCents: item.finalCents, others, mine, participants,
    taken: sum(item.claims.filter((claim) => claim.userId !== ownId)),
    changes: changes.filter((change) => change.itemId === item.id),
  };
}

/** Everyone's portions of one item, as the compact meter on its row. */
export function ItemPortionBar({ item, participants, ownId, mine, changes }: {
  item: BillItem; participants: Participant[]; ownId: string | undefined; mine: Fraction | null; changes: ClaimChange[];
}) {
  return <PortionBar {...itemPortions(item, participants, ownId, mine, changes)} compact />;
}

/** The YOUR PORTION card: the chosen portion's price, everyone's portions, and what to do if it no longer fits. */
export function ClaimPortion({ item, participants, ownId, mine, changes, over }: {
  item: BillItem; participants: Participant[]; ownId: string | undefined; mine: Fraction | null; changes: ClaimChange[];
  over: { left: Fraction; by: Fraction } | null;
}) {
  return <PortionCard {...itemPortions(item, participants, ownId, mine, changes)} label="YOUR PORTION" tone={over ? "over" : null}
    figure={<strong className={mine ? "" : "claim-portion-empty"}>{money(mine ? cost(item.finalCents, mine) : 0)}</strong>}
    caption={mine ? `${text(mine)} of ${money(item.finalCents)}` : `Pick a portion of ${money(item.finalCents)}`}>
    {over && mine && <p className="claim-over-text" role="alert">
      {over.left.n > 0n ? `Only ${shortText(over.left)} left. ` : "Nothing is left. "}
      Your {text(mine)} is over by {shortText(over.by)}. {over.left.n === 0n ? "Remove your claim to confirm." : claimable(over.left) ? `Pick ${shortText(over.left)} or less to confirm.` : "Pick a smaller portion to confirm."}
    </p>}
  </PortionCard>;
}
