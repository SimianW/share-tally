// PROTOTYPE — variant E of the bill detail page: "Confirmation timeline".
// The bill reads as a process: created → each participant confirms → shares
// match → complete (or canceled). See bill-variants.prototype.tsx.
import type { ReactNode } from "react";
import { money } from "./bill-api";
import { Avatar, Icon } from "./ui";
import type { BillVariantProps, Participant } from "./bill-variants.prototype";
import "./BillVariantE.prototype.css";

type State = "done" | "current" | "pending" | "empty" | "warning" | "canceled" | "skipped" | "missed";
type Step = {
  key: string;
  state: State;
  node: ReactNode;
  title: ReactNode;
  amount?: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
};

const day = (value: string) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00`) : new Date(value);
  return date.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
};
const shortDay = (value: string) => new Date(value).toLocaleDateString("en", { month: "short", day: "numeric" });

function Marker({ state, icon }: { state: State; icon?: ReactNode }) {
  return <span className={`bv-e-marker bv-e-marker-${state}`} aria-hidden="true">{icon}</span>;
}

export function BillVariantE({
  bill, initiator, own, headingRef, backHref, status, needsAmountCorrection, waiting, initiatorCost,
  notices, shareAction, initiatorActions,
}: BillVariantProps) {
  const items = bill.mode === "items";
  const canceled = !!bill.canceledAt;
  const completed = !!bill.completedAt;
  const diff = bill.differenceCents;
  const initiatorPossessive = initiator.isCurrentUser ? "Your" : `${initiator.displayName}'s`;

  // --- One-line money summary.
  const summary: { text: string; tone?: "match" | "over" | "left" }[] = [
    { text: `${money(bill.totalCents)} total` },
    { text: `${money(bill.submittedCents)} ${items ? "claimed" : "submitted"}` },
  ];
  if (canceled) summary.push({ text: "excluded from totals" });
  else if (items) summary.push({ text: `${money(diff)} to ${initiator.isCurrentUser ? "you" : initiator.displayName}`, tone: initiatorCost < 0 ? "over" : undefined });
  else if (completed) summary.push({ text: bill.adjustmentCents ? `${money(Math.abs(bill.adjustmentCents))} to ${initiator.isCurrentUser ? "you" : initiator.displayName}` : "shares matched", tone: "match" });
  else if (diff > 0) summary.push({ text: `${money(diff)} left to match`, tone: "left" });
  else if (diff < 0) summary.push({ text: `over by ${money(-diff)}`, tone: "over" });
  else summary.push({ text: "shares match", tone: "match" });

  // --- Steps.
  const steps: Step[] = [{
    key: "created",
    state: "done",
    node: <Marker state="done" icon={<Icon name="receipt" size={18} />} />,
    title: "Bill created",
    amount: money(bill.totalCents),
    detail: <>Paid by {initiator.isCurrentUser ? "you" : initiator.displayName} on {day(bill.purchaseDate)}</>,
  }];

  const confirmed = bill.participants.filter(p => p.confirmedAt);
  const people: Participant[] = [...confirmed, ...waiting];
  const jumpToShare = () => {
    if (items) document.querySelector(".item-claims")?.scrollIntoView({ behavior: "smooth", block: "start" });
    else document.getElementById("my-share-amount")?.focus();
  };
  for (const p of people) {
    const done = !!p.confirmedAt;
    const current = !done && !canceled && !completed && p.isCurrentUser;
    const state: State = done ? "done" : canceled ? "missed" : current ? "current" : p.amountCents === null ? "empty" : "pending";
    const role = p.userId === bill.initiatorId ? " · paid" : "";
    steps.push({
      key: p.userId,
      state,
      node: <span className={`bv-e-person bv-e-person-${state}`} aria-hidden="true">
        <Avatar name={p.displayName} imageUrl={p.imageUrl} fallbackImageUrl={p.fallbackImageUrl} />
        {done && <span className="bv-e-badge"><Icon name="check" size={11} /></span>}
      </span>,
      title: <>{p.displayName}{p.isCurrentUser && <span className="bv-e-you"> (you)</span>}<span className="bv-e-role">{role}</span></>,
      amount: p.amountCents === null ? <span className="bv-e-missing">Not submitted</span> : money(p.amountCents),
      detail: done ? <>Confirmed {shortDay(p.confirmedAt!)}</>
        : canceled ? "Did not confirm"
          : current ? <b>Your turn. {p.amountCents === null ? (items ? "Claim your items and confirm." : "Enter and confirm your share.") : "Confirm your share."}</b>
            : p.amountCents === null ? `Waiting for ${p.displayName} to ${items ? "claim items" : "submit a share"}`
              : `Waiting for ${p.displayName} to confirm`,
      action: current ? <button type="button" className="button primary bv-e-jump" onClick={jumpToShare}>
        {items ? "Go to my items" : needsAmountCorrection ? "Edit my share" : "Confirm my share"}
      </button> : undefined,
    });
  }

  // Shares-match / initiator-difference step.
  const matched = Math.abs(diff) <= 5;
  if (canceled) {
    steps.push({
      key: "canceled",
      state: "canceled",
      node: <Marker state="canceled" icon={<Icon name="close" size={16} />} />,
      title: "Canceled",
      detail: "This bill is kept for reference and excluded from financial totals. Shares can no longer be submitted or confirmed.",
    });
    steps.push({ key: "match", state: "skipped", node: <Marker state="skipped" />, title: items ? "Difference assigned" : "Shares match the total" });
    steps.push({ key: "complete", state: "skipped", node: <Marker state="skipped" />, title: "Complete" });
  } else {
    if (items) {
      const negative = initiatorCost < 0;
      steps.push({
        key: "match",
        state: completed ? "done" : negative ? "warning" : "pending",
        node: <Marker state={completed ? "done" : negative ? "warning" : "pending"} icon={completed ? <Icon name="check" size={16} /> : negative ? "!" : undefined} />,
        title: `Difference goes to ${initiator.isCurrentUser ? "you" : initiator.displayName}`,
        amount: money(diff),
        detail: negative
          ? `${initiatorPossessive} effective cost would be ${money(initiatorCost)}. The initiator must correct item prices or the paid total.`
          : `Unclaimed or rounding differences land on the initiator. ${completed ? "Final" : "Current"} effective cost ${money(initiatorCost)}.`,
      });
    } else {
      const over = diff < -5 || needsAmountCorrection;
      const state: State = completed || (matched && !needsAmountCorrection) ? "done" : over ? "warning" : "pending";
      steps.push({
        key: "match",
        state,
        node: <Marker state={state} icon={state === "done" ? <Icon name="check" size={16} /> : state === "warning" ? "!" : undefined} />,
        title: state === "done" ? "Shares match the total"
          : diff < 0 ? `Over by ${money(-diff)}` : over ? `Short by ${money(diff)}` : `${money(diff)} left to match`,
        amount: <>{money(bill.submittedCents)}<span className="bv-e-of"> of {money(bill.totalCents)}</span></>,
        detail: state === "done"
          ? (diff === 0 || (completed && !bill.adjustmentCents) ? "Every cent is accounted for." : `Within 5¢. The ${money(Math.abs(completed ? bill.adjustmentCents! : diff))} difference goes to ${initiator.isCurrentUser ? "you" : initiator.displayName}.`)
          : over ? "Combined shares must be within 5¢ of the total. Someone needs to correct their amount, and changing it asks everyone to confirm again."
            : "Combined shares must come within 5¢ of the total.",
      });
    }
    const adjustment = bill.adjustmentCents ?? 0;
    steps.push({
      key: "complete",
      state: completed ? "done" : "pending",
      node: <Marker state={completed ? "done" : "pending"} icon={completed ? <Icon name="check" size={16} /> : undefined} />,
      title: completed ? `Completed ${shortDay(bill.completedAt!)}` : "Complete",
      detail: completed ? <>
        {adjustment !== 0 && initiator.amountCents !== null && <p className="bv-e-cost">
          {initiatorPossessive} effective cost <b>{money(initiator.amountCents + adjustment)}</b>{" "}
          <span>({money(initiator.amountCents)} {adjustment < 0 ? "−" : "+"} {money(Math.abs(adjustment))} adjustment)</span>
        </p>}
        <p className="bv-e-final"><Icon name="check" size={14} /> Completed bills are final. Details, participants, and shares can no longer change.</p>
      </> : items
        ? "Completes automatically once every item is fully claimed and everyone confirms."
        : "Completes automatically when everyone confirms. Up to 5¢ goes to the initiator.",
    });
  }

  // Rail segment below step i is "done" when both ends are done; nothing after a terminal step.
  const terminal = steps.findIndex(s => s.state === "canceled");

  return (
    <section className="bills-page bv-e">
      <header className="bv-e-head">
        <a className="bv-e-back" href={backHref}><Icon name="left" size={16} />Group bills</a>
        <h1 ref={headingRef} tabIndex={-1}>{bill.title}</h1>
        <p className="bv-e-meta">{day(bill.purchaseDate)} · Paid by {initiator.isCurrentUser ? "you" : initiator.displayName} · CAD</p>
        <p className="bv-e-summary">
          <span className={`bv-e-status bv-e-status-${status.tone}`}>{status.label}</span>
          <span className="bv-e-figures">
            {summary.map((s, i) => <span key={i} className={s.tone ? `bv-e-fig-${s.tone}` : undefined}>{s.text}</span>)}
          </span>
        </p>
      </header>

      {notices}

      <section aria-labelledby="bv-e-progress">
        <h2 id="bv-e-progress" className="bv-e-h2">
          Progress <span>{bill.confirmedCount} of {bill.participants.length} confirmed</span>
        </h2>
        <ol className={`bv-e-steps${canceled ? " bv-e-steps-canceled" : ""}`}>
          {steps.map((s, i) => {
            const next = steps[i + 1];
            const rail = !next || (terminal >= 0 && i >= terminal) ? "none" : next.state === "done" && s.state === "done" ? "done" : next.state === "skipped" ? "skipped" : "pending";
            return <li key={s.key} className={`bv-e-step bv-e-step-${s.state} bv-e-key-${["created", "match", "complete", "canceled"].includes(s.key) ? s.key : "person"}`} data-rail={rail}>
              <div className="bv-e-node">{s.node}</div>
              <div className="bv-e-body">
                <div className="bv-e-line">
                  <h3>{s.title}<span className="bv-e-sr"> — {srState[s.state]}</span></h3>
                  {s.amount && <strong className="bv-e-amount">{s.amount}</strong>}
                </div>
                {s.detail && <div className="bv-e-detail">{s.detail}</div>}
                {s.action}
              </div>
            </li>;
          })}
        </ol>
      </section>

      {bill.notes && <aside className="bv-e-notes" aria-label="Purchase notes">
        <p>{bill.notes}</p>
        <span>Purchase notes from {initiator.isCurrentUser ? "you" : initiator.displayName}</span>
      </aside>}

      {(shareAction || initiatorActions) && <div className="bv-e-actions">
        {shareAction}
        {initiatorActions}
      </div>}
      {!own && <p className="bv-e-viewer">You can view this bill as a group member. Only its participants can submit shares.</p>}
    </section>
  );
}

const srState: Record<State, string> = {
  done: "done", current: "your turn", pending: "waiting", empty: "not submitted",
  warning: "needs attention", canceled: "bill canceled", skipped: "not reached", missed: "did not confirm",
};
