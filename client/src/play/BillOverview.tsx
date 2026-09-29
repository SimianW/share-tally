// The bill page is built around the viewer's own share (#158): a ticket that
// says what this bill means for them, and a panel that carries the whole bill.
import type { ReactNode } from "react";
import { money, type Bill } from "./bill-api";
import { Avatar, Icon } from "./ui";

type Participant = Bill["participants"][number];
type Tone = "act" | "done" | "warn" | "quiet" | "void";

const signed = (cents: number) => `${cents < 0 ? "−" : "+"}${money(Math.abs(cents))}`;

// Unconfirmed participants as one phrase, naming the current user first as "you".
function waitingFor(bill: Bill) {
  const waiting = bill.participants.filter(p => !p.confirmedAt);
  return new Intl.ListFormat("en", { type: "conjunction" }).format([
    ...waiting.filter(p => p.isCurrentUser).map(() => "you"),
    ...waiting.filter(p => !p.isCurrentUser).map(p => p.displayName),
  ]);
}

// One decision table drives the ticket; the order of the checks matters.
function shareState(bill: Bill, own: Participant | undefined, needsAmountCorrection: boolean) {
  const words = (text: string) => <span className="share-ticket-words">{text}</span>;
  const amount = (missing: string) => own?.amountCents == null ? words(missing) : money(own.amountCents);
  const isInitiator = own?.userId === bill.initiatorId;
  const adjustment = bill.adjustmentCents ?? 0;
  const waiting = waitingFor(bill);
  let state: { tone: Tone; stamp: string; label: string; figure: ReactNode; line: ReactNode };
  if (!own) {
    state = {
      tone: "quiet", stamp: "Viewing only", label: "You're not on this bill", figure: words("No share for you"),
      line: `You can see this bill as a group member. Only its ${bill.participants.length} participants submit and confirm shares.`,
    };
  } else if (bill.canceledAt) {
    state = {
      tone: "void", stamp: "Canceled", label: "Your share",
      figure: own.amountCents === null ? words("Nothing submitted") : <s>{money(own.amountCents)}</s>,
      line: "This bill was canceled, so you don't owe anything on it. It's kept for reference only.",
    };
  } else if (bill.completedAt) {
    // A share is an allocation, not money paid; completion is not repayment (ADR-0006).
    const finalShare = (own.amountCents ?? 0) + (isInitiator ? adjustment : 0);
    state = {
      tone: "done", stamp: "Final", label: "Your final share", figure: money(finalShare),
      line: <>Your final share is <b>{money(finalShare)}</b> of the <b>{money(bill.totalCents)}</b> bill. Nothing left to confirm.</>,
    };
  } else if (needsAmountCorrection) {
    state = {
      tone: "warn", stamp: "Check your amount", label: "Your share", figure: amount("Not submitted yet"),
      line: `Shares are ${money(Math.abs(bill.differenceCents))} ${bill.differenceCents < 0 ? "over" : "under"} the total. If yours is wrong, correct it below.`,
    };
  } else if (own.confirmedAt) {
    state = {
      tone: "done", stamp: "Confirmed", label: "Your share", figure: amount("Nothing claimed"),
      line: waiting ? `You're done for now. Waiting on ${waiting}.` : "You're done. The bill completes once the totals line up.",
    };
  } else {
    state = {
      tone: "act", stamp: "Needs your confirmation", label: "Your share",
      figure: amount(bill.mode === "items" ? "Nothing claimed yet" : "Not submitted yet"),
      line: bill.mode === "items" ? "Pick the items you bought, then confirm. An empty pick confirms you bought nothing."
        : own.amountCents === null ? "Enter what you owe, including tax, and confirm it." : "Check the saved amount and confirm it.",
    };
  }
  return state;
}

// The initiator's own amount is not their cost; show how the cost is reached.
function initiatorLedger(bill: Bill, own: Participant | undefined) {
  if (!own || own.userId !== bill.initiatorId) return null;
  const submitted = own.amountCents ?? 0;
  const adjustment = bill.adjustmentCents ?? 0;
  if (bill.mode === "items" && !bill.completedAt && !bill.canceledAt) return {
    rows: [["Your claims", money(submitted)], ["Unassigned, yours as initiator", signed(bill.differenceCents)]],
    cost: submitted + bill.differenceCents,
  };
  if (bill.completedAt && adjustment !== 0) return {
    rows: [["You submitted", money(submitted)], ["Initiator adjustment", signed(adjustment)]],
    cost: submitted + adjustment,
  };
  return null;
}

const stampIcons = { act: "receipt", done: "check", warn: "bell", quiet: "people", void: "close" } as const;

/** The viewer's share as a ticket; `children` is their share form, shown below it. */
export function ShareTicket({ bill, own, needsAmountCorrection, children }: {
  bill: Bill;
  own: Participant | undefined;
  needsAmountCorrection: boolean;
  children?: ReactNode;
}) {
  const { tone, stamp, label, figure, line } = shareState(bill, own, needsAmountCorrection);
  const ledger = initiatorLedger(bill, own);
  return <section className={`share-card share-card-${tone}`} aria-label="Your share">
    <div className="share-ticket">
      <div className="share-ticket-stub">
        <h2 className="share-ticket-label">{label}</h2>
        <p className="share-ticket-figure">{figure}</p>
        <span className="share-ticket-stamp"><Icon name={stampIcons[tone]} size={14} />{stamp}</span>
      </div>
      <div className="share-ticket-body">
        <p className="share-ticket-line">{line}</p>
        {ledger && <dl className="share-ticket-ledger">
          {ledger.rows.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}
          <div className="share-ticket-ledger-total"><dt>Effective cost</dt><dd>{money(ledger.cost)}</dd></div>
        </dl>}
        {ledger && ledger.cost < 0 && <p className="share-ticket-alert">
          Your effective cost is negative, which blocks completion. Correct item prices or the paid total.
        </p>}
      </div>
    </div>
    {children && <div className="share-card-action">{children}</div>}
  </section>;
}

function balanceRow(bill: Bill): [label: string, value: string, tone?: "ok" | "over"] {
  const adjustment = bill.adjustmentCents ?? 0;
  if (bill.mode === "items") return bill.completedAt
    ? ["Initiator adjustment", money(adjustment)] : ["Unclaimed (initiator)", money(bill.differenceCents)];
  if (bill.completedAt) return adjustment ? ["Adjustment", signed(adjustment)] : ["Matched", "✓", "ok"];
  if (bill.differenceCents > 0) return ["Left to match", money(bill.differenceCents)];
  if (bill.differenceCents < 0) return ["Over the total", money(-bill.differenceCents), "over"];
  return ["Matched", "✓", "ok"];
}

/** The whole bill: a summary, then everyone's share, the rules and initiator controls. */
export function BillPanel({ bill, needsAmountCorrection, initiatorActions }: {
  bill: Bill;
  needsAmountCorrection: boolean;
  initiatorActions: ReactNode;
}) {
  const initiator = bill.participants.find(p => p.userId === bill.initiatorId)!;
  const count = bill.participants.length;
  const adjustment = bill.adjustmentCents ?? 0;
  const waiting = waitingFor(bill);
  const [status, statusTone] = bill.canceledAt ? ["Canceled", "void"]
    : bill.completedAt ? ["Complete", "done"]
      : needsAmountCorrection ? ["Needs correction", "warn"] : ["In progress", "open"];
  const [balanceLabel, balanceValue, balanceTone] = balanceRow(bill);
  const explanation = bill.canceledAt
    ? <p className="bill-explain"><Icon name="close" size={14} />Canceled bills are excluded from balances. Shares can no longer be submitted or confirmed.</p>
    : bill.completedAt ? <>
      {adjustment !== 0 && <p className="bill-formula">
        {initiator.displayName}: {money(initiator.amountCents ?? 0)} submitted {adjustment < 0 ? "−" : "+"} {money(Math.abs(adjustment))} adjustment
        = <b>{money((initiator.amountCents ?? 0) + adjustment)} effective cost</b>
      </p>}
      <p className="bill-explain"><Icon name="check" size={14} />Complete and final. Details, participants and shares can no longer change.</p>
    </>
      // The completion rule stays visible after everyone confirms, while the bill is still open.
      : <p className="bill-explain"><Icon name="clock" size={14} />{waiting && `Waiting for ${waiting} to confirm. `}{bill.mode === "items"
        ? "Every item must be fully claimed; anything left over goes to the initiator."
        : "Up to 5¢ of difference goes to the initiator once everyone confirms."}</p>;
  return <aside className={`bill-panel${bill.canceledAt ? " bill-panel-canceled" : ""}`} aria-label="Bill">
    <section className="bill-summary" aria-label="Bill summary">
      <div className="bill-summary-top">
        <h2>Bill</h2>
        <span className={`bill-status bill-status-${statusTone}`}>{status}</span>
      </div>
      <p className="bill-total"><span>Total</span><strong>{money(bill.totalCents)}</strong></p>
      <dl className="bill-rows">
        <div><dt>Submitted</dt><dd>{money(bill.submittedCents)}</dd></div>
        <div className={balanceTone && `bill-row-${balanceTone}`}><dt>{balanceLabel}</dt><dd>{balanceValue}</dd></div>
      </dl>
      <div className="bill-confirmed">
        <span className="bill-faces" aria-hidden="true">
          {bill.participants.map(p => <span key={p.userId} className={p.confirmedAt ? "is-confirmed" : undefined}>
            <Avatar name={p.displayName} imageUrl={p.imageUrl} fallbackImageUrl={p.fallbackImageUrl} small />
          </span>)}
        </span>
        <span><b>{bill.confirmedCount}</b> of {count} confirmed</span>
        <span className="bill-progress" aria-hidden="true"><span style={{ width: `${(bill.confirmedCount / count) * 100}%` }} /></span>
      </div>
    </section>
    <section className="bill-details" aria-label="Everyone's share">
      <h2>Everyone's share</h2>
      <ul className="bill-people">
        {bill.participants.map(p => {
          const state = bill.canceledAt ? "void" : p.confirmedAt ? "in" : "out";
          return <li key={p.userId} className="bill-person">
            <Avatar name={p.displayName} imageUrl={p.imageUrl} fallbackImageUrl={p.fallbackImageUrl} small />
            <span className="bill-person-name">
              <b>{p.displayName}{p.isCurrentUser && <em> (you)</em>}</b>
              <small>
                <i className={`bill-dot bill-dot-${state}`} aria-hidden="true" />
                {state === "void" ? "Canceled" : state === "in" ? "Confirmed" : "Not confirmed"}
                {p.userId === bill.initiatorId && ", paid the bill"}
              </small>
            </span>
            <strong className={p.amountCents === null ? "bill-person-missing" : undefined}>
              {p.amountCents === null ? <><span aria-hidden="true">—</span><span className="bill-sr-only">Not submitted</span></> : money(p.amountCents)}
            </strong>
          </li>;
        })}
      </ul>
      <div className="bill-explanation">{explanation}</div>
      {bill.notes && <div className="bill-notes"><h3>Purchase notes</h3><p>{bill.notes}</p></div>}
      {initiatorActions && <div className="bill-initiator">{initiatorActions}</div>}
    </section>
  </aside>;
}
