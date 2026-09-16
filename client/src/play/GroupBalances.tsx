import { money, type GroupLedger } from './bill-api';

export function GroupBalances({ ledger }: { ledger: GroupLedger }) {
  const names = new Map(ledger.members.map(member => [member.userId, member.displayName]));
  return <section className="group-ledger" aria-label="Group balances and repayment suggestions">
    <div>
      <h3>Member balances</h3>
      <p>Completed bills across all dates. Positive means owed to the member; negative means they owe.</p>
      <ul className="ledger-rows">
        {ledger.members.map(member => <li key={member.userId}>
          <span>{member.displayName}</span>
          <strong>{member.netCents > 0 ? '+' : member.netCents < 0 ? '−' : ''}{money(Math.abs(member.netCents))}</strong>
        </li>)}
      </ul>
    </div>
    <div>
      <h3>Repayment suggestions</h3>
      <p>The fewest transfers to clear these balances. Suggestions are guidance, not payment records. ShareTally moves no money.</p>
      {ledger.suggestions.length ? <ul className="ledger-rows">
        {ledger.suggestions.map((suggestion, index) => <li key={index}>
          <span>{names.get(suggestion.fromUserId)} → {names.get(suggestion.toUserId)}</span>
          <strong>{money(suggestion.amountCents)}</strong>
        </li>)}
      </ul> : <p>No repayments needed. Every member's balance is zero.</p>}
      <p>Suggestions update automatically as bills complete.</p>
      {ledger.incompleteBillIds.length > 0 && <p className="ledger-unresolved">
        {ledger.incompleteBillIds.length} incomplete {ledger.incompleteBillIds.length === 1 ? 'bill is' : 'bills are'} excluded. You can repay the completed bills now.
      </p>}
    </div>
  </section>;
}
