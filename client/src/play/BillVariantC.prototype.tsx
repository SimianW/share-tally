// PROTOTYPE — variant C of the bill detail page ("Split bar"). See bill-variants.prototype.tsx.
// The hero is a stacked bar showing how the bill total is divided among participants.
import type { CSSProperties } from "react";
import { money } from "./bill-api";
import type { BillVariantProps } from "./bill-variants.prototype";
import { Icon } from "./ui";
import "./BillVariantC.prototype.css";

const list = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names);

function longDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

export function BillVariantC({
  bill, initiator, own, headingRef, backHref, status, needsAmountCorrection, waiting, initiatorCost,
  notices, shareAction, initiatorActions,
}: BillVariantProps) {
  const canceled = !!bill.canceledAt;
  const complete = !!bill.completedAt;
  const items = bill.mode === "items";
  const people = bill.participants.map((p, index) => ({ ...p, tint: `var(--avatar-${(index % 5) + 1})` }));
  const shared = people.reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
  const gap = bill.totalCents - shared;
  const scale = Math.max(bill.totalCents, shared, 1);
  const pct = (cents: number) => `${(cents / scale) * 100}%`;
  const totalAt = (bill.totalCents / scale) * 100;
  const over = gap < 0;
  const confirmed = bill.confirmedCount;
  const everyone = bill.participants.length;
  const adjustment = bill.adjustmentCents ?? 0;
  const payer = initiator.isCurrentUser ? "you" : initiator.displayName;
  const payerPossessive = initiator.isCurrentUser ? "Your" : `${initiator.displayName}'s`;

  const gapLabel = complete ? "adjustment" : items ? "not yet claimed" : "left to match";
  const [differenceLabel, differenceValue, differenceTone] = items
    ? ["Initiator adjustment", money(bill.differenceCents), bill.differenceCents < 0 ? "over" : ""]
    : complete ? ["Adjustment", money(adjustment), adjustment ? "" : "match"]
      : over ? ["Over the total", money(-gap), "over"]
        : gap > 0 ? ["Left to match", money(gap), needsAmountCorrection ? "over" : "open"]
          : ["Left to match", "$0.00", "match"];

  const waitingNames = waiting.map(p => p.isCurrentUser ? "you" : p.displayName);
  const sign = adjustment < 0 ? "−" : "+";

  return <section className={`bv-c${canceled ? " bv-c-canceled" : ""}`}>
    <header className="bv-c-header">
      <a className="bv-c-back" href={backHref}><Icon name="left" size={16} />Group bills</a>
      <div className="bv-c-titlerow">
        <h1 ref={headingRef} tabIndex={-1}>{bill.title}</h1>
        <span className={`bv-c-status bv-c-status-${status.tone}`}>{status.label}</span>
      </div>
      <p className="bv-c-meta">Paid by {payer} on {longDate(bill.purchaseDate)}, in CAD</p>
    </header>

    {notices}

    <section className="bv-c-split" aria-labelledby="bv-c-split-title">
      <h2 id="bv-c-split-title">How {money(bill.totalCents)} is split</h2>

      <div className={`bv-c-bar${over ? " bv-c-bar-over" : ""}`} aria-hidden="true">
        <div className="bv-c-track">
          {people.filter(p => p.amountCents).map(p => (
            <span key={p.userId}
              className={`bv-c-seg${p.confirmedAt ? "" : " bv-c-seg-pending"}${p.isCurrentUser ? " bv-c-seg-you" : ""}`}
              style={{ width: pct(p.amountCents!), "--seg": p.tint } as CSSProperties}>
              <span className="bv-c-seg-label">
                <b>{p.isCurrentUser ? "You" : p.displayName}</b>
                <span>{money(p.amountCents!)}</span>
              </span>
            </span>
          ))}
          {gap > 0 && <span className={`bv-c-gap${needsAmountCorrection ? " bv-c-gap-warn" : ""}${complete || items ? " bv-c-gap-adjust" : ""}`}
            style={{ width: pct(gap) }}>
            <span className="bv-c-seg-label"><span>{money(gap)}<span className="bv-c-gap-words"> {gapLabel}</span></span></span>
          </span>}
        </div>
        {over && <span className="bv-c-overflow" style={{ left: `${totalAt}%` }}>
          <span className="bv-c-seg-label"><span>+{money(-gap)}</span></span>
        </span>}
        {over && <span className="bv-c-tick" style={{ left: `${totalAt}%` }} />}
      </div>

      <div className="bv-c-scale" aria-hidden="true">
        <span>$0</span>
        <span className="bv-c-scale-total" style={over ? { right: `${100 - totalAt}%` } : undefined}>
          Bill total <b>{money(bill.totalCents)}</b>
        </span>
      </div>

      <dl className="bv-c-facts">
        <div><dt>Submitted</dt><dd>{money(bill.submittedCents)}</dd></div>
        <div className={differenceTone ? `bv-c-fact-${differenceTone}` : undefined}>
          <dt>{differenceLabel}</dt>
          <dd>{differenceValue}{differenceTone === "match" && <Icon name="check" size={16} />}</dd>
        </div>
        <div><dt>Confirmed</dt><dd>{confirmed} of {everyone}</dd></div>
      </dl>
    </section>

    {(canceled || complete || items || (waiting.length > 0 && !needsAmountCorrection)) && <p className="bv-c-explain">
      {canceled ? <>
        <Icon name="close" size={14} />
        <span>Canceled. The bill is kept for reference but doesn't count toward balances, and shares can no longer change.</span>
      </> : complete ? <>
        <Icon name="check" size={14} />
        <span>
          {adjustment !== 0
            ? <>{payerPossessive} cost: {money(initiator.amountCents!)} submitted {sign} {money(Math.abs(adjustment))} adjustment = <b>{money(initiator.amountCents! + adjustment)} effective cost</b>. </>
            : "Shares matched the total exactly. "}
          Completed bills are final.
        </span>
      </> : <>
        <Icon name="clock" size={14} />
        <span>
          {items && <>{payerPossessive} effective cost is <b>{money(initiatorCost)}</b> based on confirmed claims{initiatorCost < 0 ? ", which is negative; item prices or the paid total need correcting" : ""}. </>}
          {waiting.length > 0 && <>Waiting for {list(waitingNames)} to confirm. </>}
          {!items && waiting.length > 0 && "Up to 5¢ goes to the initiator once everyone confirms."}
        </span>
      </>}
    </p>}

    <section aria-labelledby="bv-c-people-title">
      <h2 id="bv-c-people-title" className="bv-c-section-title">Everyone's share <span>{everyone}</span></h2>
      <ul className="bv-c-tiles">
        {people.map(p => {
          const isInitiator = p.userId === bill.initiatorId;
          const effective = isInitiator && complete && adjustment !== 0 ? p.amountCents! + adjustment : null;
          return <li key={p.userId}
            className={`bv-c-tile${p.isCurrentUser ? " bv-c-tile-you" : ""}${p.confirmedAt ? "" : " bv-c-tile-pending"}`}
            style={{ "--seg": p.tint } as CSSProperties}>
            <span className="bv-c-key" aria-hidden="true">{p.displayName.trim().slice(0, 1).toUpperCase()}</span>
            <div className="bv-c-who">
              <b>{p.displayName}{p.isCurrentUser && <span className="bv-c-you"> (you)</span>}</b>
              <span>{isInitiator ? "Paid the bill" : "Participant"}</span>
            </div>
            <span className="bv-c-pct">{p.amountCents === null ? "" : `${Math.round((p.amountCents / Math.max(bill.totalCents, 1)) * 100)}%`}</span>
            <strong className={`bv-c-amount${p.amountCents === null ? " bv-c-amount-missing" : ""}`}>
              {p.amountCents === null ? "Not submitted" : money(p.amountCents)}
              {effective !== null && <small>{money(effective)} effective</small>}
            </strong>
            <span className={`bv-c-state${p.confirmedAt && !canceled ? " bv-c-state-done" : ""}`}>
              <Icon name={canceled ? "close" : p.confirmedAt ? "check" : "clock"} size={14} />
              {canceled ? "Bill canceled" : p.confirmedAt ? "Confirmed" : "Awaiting confirmation"}
            </span>
          </li>;
        })}
      </ul>
    </section>

    {bill.notes && <section aria-labelledby="bv-c-notes-title">
      <h2 id="bv-c-notes-title" className="bv-c-section-title">Purchase notes</h2>
      <p className="bv-c-notes">{bill.notes}</p>
    </section>}

    <div className="bv-c-actions">
      {shareAction}
      {initiatorActions}
    </div>
    {!own && <p className="bv-c-viewer">You can view this bill as a group member. Only its participants can submit shares.</p>}
  </section>;
}
