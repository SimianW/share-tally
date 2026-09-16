import { useLayoutEffect, useRef } from 'react';
import { AnimatedMoney } from './AnimatedMoney';
import { money, type GroupLedger } from './bill-api';

export function GroupBalances({ ledger }: { ledger: GroupLedger }) {
  const rows = useRef<HTMLUListElement>(null);
  const previous = useRef(ledger.suggestions);
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = ledger.suggestions;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animations: Animation[] = [];
    ledger.suggestions.forEach((suggestion, index) => {
      if (!old.some(row => row.fromUserId === suggestion.fromUserId && row.toUserId === suggestion.toUserId && row.amountCents === suggestion.amountCents)) {
        const node = rows.current?.children[index];
        if (node) animations.push(node.animate([{ backgroundColor: '#f5df9b' }, { backgroundColor: 'transparent' }], { duration: 450 }));
      }
    });
    return () => animations.forEach(animation => animation.cancel());
  }, [ledger.suggestions]);
  const names = new Map(ledger.members.map(member => [member.userId, member.displayName]));
  return <section className="group-ledger" aria-label="Group balances and repayment suggestions">
    <div>
      <h3>Member balances</h3>
      <p>+ Receivable · − Payable</p>
      <ul className="ledger-rows">
        {ledger.members.map(member => <li key={member.userId}>
          <span>{member.displayName}</span>
          <strong>{member.netCents > 0 ? '+' : member.netCents < 0 ? '−' : ''}<AnimatedMoney cents={member.netCents} /></strong>
        </li>)}
      </ul>
    </div>
    <div>
      <h3>Repayment suggestions</h3>
      <p>Suggested transfers to settle up.</p>
      {ledger.suggestions.length ? <ul ref={rows} className="ledger-rows">
        {ledger.suggestions.map((suggestion) => <li key={`${suggestion.fromUserId}:${suggestion.toUserId}`}>
          <span>{names.get(suggestion.fromUserId)} → {names.get(suggestion.toUserId)}</span>
          <strong>{money(suggestion.amountCents)}</strong>
        </li>)}
      </ul> : <p>No repayments needed.</p>}
      {ledger.incompleteBillIds.length > 0 && <p className="ledger-unresolved">
        {ledger.incompleteBillIds.length} incomplete {ledger.incompleteBillIds.length === 1 ? 'bill' : 'bills'} excluded.
      </p>}
    </div>
  </section>;
}
