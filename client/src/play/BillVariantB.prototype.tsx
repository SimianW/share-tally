// PROTOTYPE — variant B of the bill detail page: the bill as one printed slip.
// See bill-variants.prototype.tsx.
import type { BillVariantProps } from "./bill-variants.prototype";
import { money } from "./bill-api";
import { Icon } from "./ui";
import "./BillVariantB.prototype.css";

const signed = (cents: number) => `${cents < 0 ? "−" : "+"}${money(Math.abs(cents))}`;

export function BillVariantB({
  bill, initiator, own, headingRef, backHref, status, needsAmountCorrection, waiting, initiatorCost,
  notices, shareAction, initiatorActions,
}: BillVariantProps) {
  const canceled = !!bill.canceledAt;
  const complete = !!bill.completedAt;
  const items = bill.mode === "items";
  const adjustment = bill.adjustmentCents ?? 0;
  const initiatorName = initiator.isCurrentUser ? "you" : initiator.displayName;

  // The last printed line resolves the bill: what is left, what is over, or where the difference went.
  const [finalLabel, finalValue, finalTone] = canceled ? ["Excluded from totals", money(0), "void"]
    : items ? ["Initiator adjustment", signed(bill.differenceCents), ""]
      : complete ? adjustment ? [`Adjustment to ${initiator.displayName}`, signed(adjustment), ""] : ["Matched ✓", money(0), "match"]
        : bill.differenceCents > 0 ? ["Left to match", money(bill.differenceCents), needsAmountCorrection ? "warn" : ""]
          : bill.differenceCents < 0 ? ["Over by", money(-bill.differenceCents), "warn"]
            : ["Matched ✓", money(0), "match"];

  const waitingFor = new Intl.ListFormat("en", { type: "conjunction" })
    .format(waiting.map(p => p.isCurrentUser ? "you" : p.displayName));

  return <section className={`bills-page bv-b${canceled ? " bv-b-canceled" : ""}`}>
    <a className="bill-back" href={backHref}><Icon name="left" size={16} />Group bills</a>
    {notices}
    <article className="bv-b-slip" aria-labelledby="bv-b-title">
      <header className="bv-b-head">
        <p className="bv-b-date">{bill.purchaseDate}</p>
        <h1 id="bv-b-title" ref={headingRef} tabIndex={-1}>{bill.title}</h1>
        <p className="bv-b-paid">Paid by {initiator.displayName}{initiator.isCurrentUser && " (you)"} · CAD</p>
        <p className={`bv-b-stamp bv-b-stamp-${status.tone}`}><span>{status.label}</span></p>
      </header>

      <ul className="bv-b-ledger" aria-label="Everyone's share">
        {bill.participants.map(p => {
          const initiatorRow = p.userId === bill.initiatorId;
          const state = canceled ? "Bill canceled" : p.confirmedAt ? "Confirmed" : "Awaiting confirmation";
          return <li key={p.userId} className={p.confirmedAt ? "bv-b-confirmed" : "bv-b-pending"}>
            <span className="bv-b-name">
              {p.displayName}
              {p.isCurrentUser && <small>you</small>}
              {initiatorRow && <small>paid</small>}
            </span>
            <span className="bv-b-leader" aria-hidden="true" />
            <span className={`bv-b-amount${p.amountCents === null ? " bv-b-missing" : ""}`}>
              {p.amountCents === null ? "Not submitted" : money(p.amountCents)}
            </span>
            <span className="bv-b-mark" role="img" aria-label={state} title={state}>
              {canceled ? "–" : p.confirmedAt ? "✓" : "○"}
            </span>
          </li>;
        })}
      </ul>

      <dl className="bv-b-totals">
        <div><dt>Submitted</dt><dd>{money(bill.submittedCents)}</dd></div>
        <div><dt>Bill total</dt><dd>{money(bill.totalCents)}</dd></div>
        <div className={`bv-b-final${finalTone ? ` bv-b-final-${finalTone}` : ""}`}>
          <dt>{finalLabel}</dt>
          <dd>{finalValue}</dd>
        </div>
      </dl>

      <footer className="bv-b-foot">
        <p className="bv-b-count">
          {bill.confirmedCount} of {bill.participants.length} confirmed
          <span className="bv-b-ticks" aria-hidden="true">
            {bill.participants.map((p, i) => <i key={p.userId} className={i < bill.confirmedCount ? "on" : undefined} />)}
          </span>
        </p>
        {complete && adjustment !== 0 && <p className="bv-b-effective">
          {initiator.displayName}: {money(initiator.amountCents!)} submitted {adjustment < 0 ? "−" : "+"} {money(Math.abs(adjustment))} adjustment
          = <b>{money(initiator.amountCents! + adjustment)} effective cost</b>
        </p>}
        {items && !complete && !canceled && <p className="bv-b-effective">
          Based on confirmed claims, {initiatorName === "you" ? "your" : `${initiatorName}'s`} effective cost is <b>{money(initiatorCost)}</b>.
          {initiatorCost < 0 && " This is negative. The initiator must correct item prices or the paid total, then get the required confirmations."}
        </p>}
        {canceled ? <p>Canceled. Kept for reference and excluded from financial totals. Shares can no longer be submitted or confirmed.</p>
          : complete ? <p>Complete. Details, participants and shares are final.</p>
            : !needsAmountCorrection && waiting.length > 0 && <p>
              Waiting for {waitingFor} to confirm.{" "}
              {items ? "Every item must be fully claimed and confirmed." : "Up to five cents can go to the initiator once everyone confirms."}
            </p>}
      </footer>

      {bill.notes && <aside className="bv-b-notes" aria-label="Purchase notes">
        <p><span aria-hidden="true">* </span>{bill.notes}</p>
      </aside>}
    </article>

    <div className="bill-action-layout bv-b-actions">
      {shareAction}
      {initiatorActions}
    </div>
    {!own && <p className="bill-viewer-note">You can view this bill as a group member. Only its participants can submit shares.</p>}
  </section>;
}
