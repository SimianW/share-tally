import { useState, type MouseEvent } from 'react';
import { money, type LedgerEntry } from './bill-api';
import Dialog from './Dialog';
import type { GroupPageData, GroupView } from './group-view';
import { entryCount, entryDate, recentLines, signed, tone, type Suggestion, type Trace } from './ledger-trace';
import { transferReason, wording } from './transfer-reason';
import { Icon } from './ui';

// One receipt line: a ledger entry and its signed amount for this explanation.
// Its detail is a few short facts, each kept on one line.
type Line = { entry: LedgerEntry; cents: number; detail: string[] };
type Props = { data: GroupPageData; view: GroupView };

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
function people(view: GroupView) {
  const words = wording(view);
  // "your" / "Carl's", for "your share of Carl's bill".
  const whose = (id: string) => id === view.me.id ? 'your' : `${view.name(id)}'s`;
  return { ...words, whose };
}

// The mobile explanation of a balance or a suggested transfer, in the shared
// dialog's bottom-sheet presentation: a receipt of the server's ledger lines
// that adds up to the tapped figure.
export function BalanceSheet({ data, view, trace, close }: Props & { trace: Trace; close: () => void }) {
  const { subject: who, object: whom, verb } = wording(view);
  const displayName = (id: string) => view.members.find(member => member.userId === id)?.displayName ?? view.name(id);
  const title = trace.kind === 'member'
    ? trace.userId === view.me.id ? 'Your balance' : `${displayName(trace.userId)}'s balance`
    : `${who(trace.suggestion.fromUserId)} ${verb(trace.suggestion.fromUserId, 'pay')} ${whom(trace.suggestion.toUserId)}`;
  return <Dialog title={title} kicker="HOW IT ADDS UP" className="receipt-sheet balance-sheet"
    closeLabel="Close explanation" closeOnOutsideClick close={close}>
    {trace.kind === 'member' ? <MemberReceipt data={data} view={view} userId={trace.userId} />
      : <TransferReceipt data={data} view={view} suggestion={trace.suggestion} />}
    <OpenBillsNote data={data} />
  </Dialog>;
}

// Incomplete bills are left out of every balance and transfer until they complete.
export function OpenBillsNote({ data }: { data: GroupPageData }) {
  const open = data.bills.filter(bill => data.ledger.incompleteBillIds.includes(bill.id));
  return open.length > 0 && <p className="ledger-trace-note">
    <Icon name="clock" size={13} />Not counted yet: {open.map(bill => bill.title).join(', ')} (still open)
  </p>;
}

// Every entry with an effect on the member: what they paid, their share and any
// initiator adjustment, and the signed effect. The lines sum to their balance.
function MemberReceipt({ data, view, userId }: Props & { userId: string }) {
  const { whose } = people(view);
  const member = view.members.find(member => member.userId === userId);
  const self = userId === view.me.id;
  const lines = data.ledger.entries.flatMap((entry): Line[] => {
    if (entry.kind === 'repayment') {
      const effect = entry.effects.find(effect => effect.userId === userId);
      return effect ? [{ entry, cents: effect.netCents, detail: [] }] : [];
    }
    const effect = entry.effects.find(effect => effect.userId === userId);
    if (!effect) return [];
    const { paidCents, shareCents, adjustmentCents } = effect;
    // Shown with its own sign: like the share, it is subtracted from what was paid.
    const detail = paidCents
      ? [`Paid ${money(paidCents)}`, `share ${money(shareCents)}`, ...adjustmentCents ? [`initiator adjustment ${signed(adjustmentCents)}`] : []]
      : [`Share ${money(shareCents)} of ${whose(entry.initiatorId)} ${money(entry.totalCents)} bill`];
    return [{ entry, cents: effect.netCents, detail }];
  });
  const they = self ? 'you' : view.name(userId);
  const net = member?.netCents ?? 0;
  return <>
    <p className="balance-sheet-intro">
      Each bill adds what {they} paid and subtracts {self ? 'your' : 'their'} share and any initiator adjustment.
      Each confirmed repayment adds what {they} sent and subtracts what {they} received.
    </p>
    <table aria-label="How it adds up" tabIndex={-1}>
      <LineRows lines={lines} view={view} toned empty="No complete bills or confirmed repayments yet." />
      <tfoot>
        <tr>
          <th scope="row">Balance</th>
          <td className={tone(net)}>{signed(net)}</td>
        </tr>
      </tfoot>
    </table>
  </>;
}

// What the payer owes the recipient directly, what the fewest-transfers
// simplification passed along, the total, and the payer's other suggestions.
function TransferReceipt({ data, view, suggestion }: Props & { suggestion: Suggestion }) {
  const { subject: who, object: whom, verb, whose } = people(view);
  const { fromUserId: from, toUserId: to, amountCents } = suggestion;
  const { directLines, directCents, passedAlongCents: passed } = suggestion.explanation;
  const entries = new Map(data.ledger.entries.map(entry => [entry.id, entry]));
  const lines = directLines.flatMap((line): Line[] => {
    const entry = entries.get(line.entryId);
    if (!entry) return [];
    // A bill between the two is always one of theirs: the other owes its initiator a share.
    const detail = entry.kind === 'repayment' ? [] : [capitalize(entry.initiatorId === to
      ? `${whose(from)} share of ${whose(to)} bill` : `${whose(to)} share of ${whose(from)} bill`)];
    return [{ entry, cents: line.cents, detail }];
  });
  const reason = transferReason(suggestion, data.ledger, view);
  const payerNet = view.members.find(member => member.userId === from)?.netCents ?? 0;
  const split = view.suggestions.filter(other => other.fromUserId === from)
    .map(other => `${money(other.amountCents)} to ${whom(other.toUserId)}`);
  return <>
    <p className="balance-sheet-intro">
      Each bill or repayment directly between {whom(from)} and {whom(to)} adds to or takes from
      what {whom(from)} {verb(from, 'owe')} {whom(to)}{passed !== 0 && '; settling other debts in fewer transfers changes the rest'}.
    </p>
    <table aria-label="How it adds up" tabIndex={-1}>
      <LineRows lines={lines} view={view} empty="No bill or repayment is directly between them." />
      <tbody className="balance-sheet-sums">
        <tr className="balance-sheet-subtotal">
          <th scope="row">{who(from)} {verb(from, 'owe')} {whom(to)} directly</th>
          <td>{signed(directCents)}</td>
        </tr>
        {passed !== 0 && <tr className="balance-sheet-passed">
          <th scope="row">
            <span className="ledger-row-label">
              <span>{passed > 0 ? 'Passed along' : 'Sent elsewhere'}</span>
              {reason && <small>{reason}</small>}
            </span>
          </th>
          <td>{signed(passed)}</td>
        </tr>}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Suggested transfer</th>
          <td>{money(amountCents)}</td>
        </tr>
      </tfoot>
    </table>
    <p className="balance-sheet-split">
      {capitalize(whose(from))} whole balance is <b>{signed(payerNet)}</b>: {new Intl.ListFormat('en', { type: 'conjunction' }).format(split)}.
    </p>
  </>;
}

// The receipt's lines, with long histories folded as in the desktop table: the
// most recent lines, after one row that sums the earlier ones.
function LineRows({ lines, view, toned = false, empty }: { lines: Line[]; view: GroupView; toned?: boolean; empty: string }) {
  const [showAll, setShowAll] = useState(false);
  const { hidden, shown } = recentLines(lines, showAll);
  const earlier = hidden.reduce((sum, line) => sum + line.cents, 0);
  const amount = (cents: number) => <td className={toned ? tone(cents) || undefined : undefined}>{signed(cents)}</td>;
  // The button disappears with its row, so focus moves to the table it revealed.
  const reveal = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest('table')?.focus({ preventScroll: true });
    setShowAll(true);
  };
  return <tbody>
    {hidden.length > 0 && <tr className="balance-sheet-earlier">
      <th scope="row">
        <span className="ledger-row-label">
          <span>Earlier bills and repayments</span>
          <small>{entryCount(hidden.length)} · <button type="button" className="ledger-show-all" onClick={reveal}>Show all</button></small>
        </span>
      </th>
      {amount(earlier)}
    </tr>}
    {shown.map(({ entry, cents, detail }) => <tr key={entry.id}>
      <th scope="row">
        <span className="ledger-row-label">
          {entry.kind === 'bill' ? <a href={`#/bills/${entry.id}`}>{entry.title}</a>
            : <span>Repayment · {view.name(entry.senderId)} → {view.name(entry.recipientId)}</span>}
          <small className="balance-sheet-detail">
            <span>{entryDate(entry)}</span>
            {detail.length > 0 && <span>{detail.map((fact, index) => <span key={index}>{index > 0 && ' · '}<span>{fact}</span></span>)}</span>}
          </small>
        </span>
      </th>
      {amount(cents)}
    </tr>)}
    {!lines.length && <tr><td colSpan={2} className="balance-sheet-empty">{empty}</td></tr>}
  </tbody>;
}
