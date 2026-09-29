// PROTOTYPE — variant D of the bill detail page. See bill-variants.prototype.tsx.
// "Your share first": the main column is about the viewer's own task; a sticky
// side panel carries the whole bill. On mobile the panel splits into a summary
// strip (first) and the people/details block (last).
import type { ReactNode } from "react";
import { money } from "./bill-api";
import { Avatar, Icon } from "./ui";
import type { BillVariantProps } from "./bill-variants.prototype";
import "./BillVariantD.prototype.css";

type Tone = "act" | "done" | "warn" | "quiet" | "void";

// Three designs for the "Your share" card; everything else in D is shared.
export function BillVariantD1(props: BillVariantProps) { return <BillVariantD {...props} share={1} />; }
export function BillVariantD2(props: BillVariantProps) { return <BillVariantD {...props} share={2} />; }
export function BillVariantD3(props: BillVariantProps) { return <BillVariantD {...props} share={3} />; }

function BillVariantD({
  bill, initiator, own, headingRef, backHref, status, needsAmountCorrection, waiting,
  initiatorCost, notices, shareAction, initiatorActions, share,
}: BillVariantProps & { share: 1 | 2 | 3 }) {
  const items = bill.mode === "items";
  const open = !bill.completedAt && !bill.canceledAt;
  const count = bill.participants.length;
  const isInitiator = own?.userId === bill.initiatorId;
  const adjustment = bill.adjustmentCents ?? 0;
  const list = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names);
  const waitingNames = list(waiting.map(p => (p.isCurrentUser ? "you" : p.displayName)));

  // ---- The hero: what this bill means for me, and what I should do now.
  let tone: Tone;
  let chip: string;
  let label: string;
  let figure: ReactNode;
  let line: ReactNode;
  if (!own) {
    tone = "quiet"; chip = "Viewing only"; label = "You're not on this bill";
    figure = <span className="bv-d-figure-words">No share for you</span>;
    line = `You can see this bill as a group member. Only its ${count} participants submit and confirm shares.`;
  } else if (bill.canceledAt) {
    tone = "void"; chip = "Canceled"; label = "Your share";
    figure = own.amountCents === null ? <span className="bv-d-figure-words">Nothing submitted</span> : <s>{money(own.amountCents)}</s>;
    line = "This bill was canceled, so you don't owe anything on it. It's kept for reference only.";
  } else if (bill.completedAt) {
    const paid = (own.amountCents ?? 0) + (isInitiator ? adjustment : 0);
    tone = "done"; chip = "Final"; label = "Your final share";
    figure = money(paid);
    // The ledger below breaks down an initiator adjustment, so the line stays short.
    line = <>You paid <b>{money(paid)}</b> of the <b>{money(bill.totalCents)}</b> bill. Nothing left to do.</>;
  } else if (needsAmountCorrection) {
    tone = "warn"; chip = "Check your amount"; label = "Your share";
    figure = own.amountCents === null ? <span className="bv-d-figure-words">Not submitted yet</span> : money(own.amountCents);
    line = `Shares are ${money(Math.abs(bill.differenceCents))} ${bill.differenceCents < 0 ? "over" : "under"} the total. If yours is wrong, correct it below.`;
  } else if (own.confirmedAt) {
    tone = "done"; chip = "Confirmed"; label = "Your share";
    figure = own.amountCents === null ? <span className="bv-d-figure-words">Nothing claimed</span> : money(own.amountCents);
    line = waiting.length ? `You're done for now. Waiting on ${waitingNames}.` : "You're done. The bill completes once the totals line up.";
  } else {
    tone = "act"; chip = "Needs your confirmation"; label = "Your share";
    figure = own.amountCents === null ? <span className="bv-d-figure-words">{items ? "Nothing claimed yet" : "Not submitted yet"}</span> : money(own.amountCents);
    line = items ? "Pick the items you bought, then confirm. An empty pick confirms you bought nothing."
      : own.amountCents === null ? "Enter what you owe, including tax, and confirm it." : "Check the saved amount and confirm it.";
  }
  // The initiator's own number isn't their final cost: show the arithmetic as a small ledger.
  const ledger: [string, string, boolean?][] | null = own && isInitiator && open && items
    ? [["Your claims", money(own.amountCents ?? 0)],
      ["Unassigned, yours as initiator", `+${money(bill.differenceCents)}`],
      ["Effective cost", money(initiatorCost), true]]
    : own && isInitiator && bill.completedAt && adjustment !== 0
      ? [["You submitted", money(own.amountCents ?? 0)],
        ["Initiator adjustment", `${adjustment < 0 ? "−" : "+"}${money(Math.abs(adjustment))}`],
        ["Effective cost", money((own.amountCents ?? 0) + adjustment), true]]
      : null;
  const ledgerList = ledger && <dl className="bv-d-ledger">
    {ledger.map(([term, value, total]) => <div key={term} className={total ? "is-total" : undefined}>
      <dt>{term}</dt><dd>{value}</dd>
    </div>)}
  </dl>;
  // Design 3 walks me through my own part: submit, confirm, then everyone else.
  const submitted = own?.amountCents !== null && own?.amountCents !== undefined;
  const steps: [string, string, "done" | "now" | "later"][] = [
    [items ? "Claim items" : "Enter amount", submitted ? money(own!.amountCents!) : items ? "Pick what you bought" : "Not entered yet", submitted ? "done" : "now"],
    ["Confirm", own?.confirmedAt ? "Done" : submitted || items ? "Your turn" : "After you enter it", own?.confirmedAt ? "done" : submitted || items ? "now" : "later"],
    ["Everyone confirms", bill.completedAt ? "Bill complete" : `${bill.confirmedCount} of ${count} so far`, bill.completedAt ? "done" : own?.confirmedAt ? "now" : "later"],
  ];
  const icon = tone === "done" ? "check" : tone === "void" ? "close" : tone === "quiet" ? "people" : tone === "warn" ? "bell" : "receipt";

  // ---- The panel: the whole bill at a glance.
  const [balanceLabel, balanceValue, balanceTone] = items
    ? [bill.completedAt ? "Initiator adjustment" : "Unclaimed (initiator)", money(bill.completedAt ? adjustment : bill.differenceCents), ""]
    : bill.completedAt ? adjustment ? ["Adjustment", `${adjustment < 0 ? "−" : "+"}${money(Math.abs(adjustment))}`, ""] : ["Matched", "✓", "ok"]
      : bill.differenceCents > 0 ? ["Left to match", money(bill.differenceCents), ""]
        : bill.differenceCents < 0 ? ["Over the total", money(-bill.differenceCents), "over"] : ["Matched", "✓", "ok"];
  const explanation = bill.canceledAt
    ? <p className="bv-d-explain"><Icon name="close" size={14} />Canceled bills are excluded from balances. Shares can no longer be submitted or confirmed.</p>
    : bill.completedAt
      ? <>
        {adjustment !== 0 && <p className="bv-d-formula">{initiator.displayName}: {money(initiator.amountCents ?? 0)} submitted {adjustment < 0 ? "−" : "+"} {money(Math.abs(adjustment))} adjustment = <b>{money((initiator.amountCents ?? 0) + adjustment)} effective cost</b></p>}
        <p className="bv-d-explain"><Icon name="check" size={14} />Complete and final. Nothing on this bill can change.</p>
      </>
      : waiting.length > 0 && <p className="bv-d-explain"><Icon name="clock" size={14} />Waiting for {waitingNames} to confirm. {items
        ? "Every item must be fully claimed; anything left over goes to the initiator."
        : "Up to 5¢ of difference goes to the initiator once everyone confirms."}</p>;
  const confirmedPct = `${(bill.confirmedCount / count) * 100}%`;

  const summary = <section className="bv-d-summary" aria-label="Bill summary">
    <div className="bv-d-summary-top">
      <h2>Bill</h2>
      <span className={`bv-d-status bv-d-status-${status.tone}`}>{status.label}</span>
    </div>
    <p className="bv-d-total"><span>Total</span><strong>{money(bill.totalCents)}</strong></p>
    <dl className="bv-d-rows">
      <div><dt>Submitted</dt><dd>{money(bill.submittedCents)}</dd></div>
      <div className={balanceTone ? `bv-d-row-${balanceTone}` : undefined}><dt>{balanceLabel}</dt><dd>{balanceValue}</dd></div>
    </dl>
    <div className="bv-d-confirmed">
      <span className="bv-d-faces" aria-hidden="true">
        {bill.participants.map(p => <span key={p.userId} className={p.confirmedAt ? "is-in" : undefined}>
          <Avatar name={p.displayName} imageUrl={p.imageUrl} fallbackImageUrl={p.fallbackImageUrl} small />
        </span>)}
      </span>
      <span><b>{bill.confirmedCount}</b> of {count} confirmed</span>
      <span className="bv-d-track" aria-hidden="true"><span style={{ width: confirmedPct }} /></span>
    </div>
  </section>;

  const details = <section className="bv-d-details" aria-label="Everyone's share">
    <h2 className="bv-d-details-heading">Everyone's share</h2>
    <ul className="bv-d-people">
      {bill.participants.map(p => {
        const state = bill.canceledAt ? "void" : p.confirmedAt ? "in" : "out";
        return <li key={p.userId}>
          <Avatar name={p.displayName} imageUrl={p.imageUrl} fallbackImageUrl={p.fallbackImageUrl} small />
          <span className="bv-d-person">
            <b>{p.displayName}{p.isCurrentUser && <em> (you)</em>}</b>
            <small>
              <i className={`bv-d-dot bv-d-dot-${state}`} aria-hidden="true" />
              {state === "void" ? "Canceled" : state === "in" ? "Confirmed" : "Not confirmed"}
              {p.userId === bill.initiatorId && ", paid the bill"}
            </small>
          </span>
          <strong className={p.amountCents === null ? "bv-d-missing" : undefined}>{p.amountCents === null ? "—" : money(p.amountCents)}</strong>
        </li>;
      })}
    </ul>
    {explanation && <div className="bv-d-explanation">{explanation}</div>}
    {bill.notes && <div className="bv-d-notes"><h3>Purchase notes</h3><p>{bill.notes}</p></div>}
    {initiatorActions && <div className="bv-d-initiator">{initiatorActions}</div>}
  </section>;

  return <section className={`bv-d bv-d-${tone}${bill.canceledAt ? " bv-d-canceled" : ""}${items ? " bv-d-items" : ""}`}>
    <header className="bv-d-header">
      <a className="bv-d-back" href={backHref}><Icon name="left" size={16} />Group bills</a>
      <h1 ref={headingRef} tabIndex={-1}>{bill.title}</h1>
      <p className="bv-d-meta">{bill.purchaseDate}, paid by {initiator.isCurrentUser ? "you" : initiator.displayName}, in CAD</p>
    </header>
    <aside className="bv-d-panel">
      {summary}
      {details}
    </aside>
    <div className="bv-d-main">
      {notices}
      <section className="bv-d-task" aria-label="Your share">
        {share === 1 ? <div className="bv-d-hero">
          <div className="bv-d-hero-top">
            <span className="bv-d-badge" aria-hidden="true"><Icon name={icon} size={18} /></span>
            <span className="bv-d-hero-titles">
              <span className="bv-d-label">{label}</span>
              <span className="bv-d-state">{chip}</span>
            </span>
          </div>
          <p className="bv-d-figure">{figure}</p>
          <p className="bv-d-line">{line}</p>
          {ledgerList}
        </div> : share === 2 ? <div className="bv-d-ticket">
          <div className="bv-d-stub">
            <span className="bv-d-label">{label}</span>
            <p className="bv-d-figure">{figure}</p>
            <span className="bv-d-stamp"><Icon name={icon} size={14} />{chip}</span>
          </div>
          <div className="bv-d-ticket-body">
            <p className="bv-d-line">{line}</p>
            {ledgerList}
          </div>
        </div> : <div className="bv-d-steps-hero">
          <h2 className="bv-d-sentence">
            {!own ? figure : own.amountCents !== null ? <>{label} <span className="bv-d-sentence-verb">is</span> <span className="bv-d-sentence-figure">{figure}</span></> : <>{label}<span className="bv-d-sentence-verb">:</span> <span className="bv-d-sentence-words">{figure}</span></>}
          </h2>
          <p className="bv-d-line">{line}</p>
          {own && <ol className={`bv-d-steps${bill.canceledAt ? " is-void" : ""}`} aria-label="Your progress">
            {steps.map(([title, detail, state]) => <li key={title} className={`is-${state}`}>
              <span className="bv-d-step-dot" aria-hidden="true">{state === "done" && <Icon name="check" size={12} />}</span>
              <span className="bv-d-step-text"><b>{title}</b><small>{detail}</small></span>
            </li>)}
          </ol>}
          {ledgerList}
        </div>}
        {!items && shareAction && <div className="bv-d-action">{shareAction}</div>}
      </section>
      {items && shareAction && <div className="bv-d-claims">{shareAction}</div>}
    </div>
  </section>;
}
