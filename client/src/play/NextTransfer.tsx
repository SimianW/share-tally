import type { GroupLedger } from './bill-api';
import type { GroupDetail } from './group-api';
import { money } from './bill-api';
import { Button, Icon } from './ui';

export function NextTransfer({ ledger, group, viewRepayments }: {
  ledger: GroupLedger; group: GroupDetail; viewRepayments: () => void;
}) {
  const me = group.members.find(member => member.isCurrentUser)?.id;
  const suggestion = ledger.suggestions.find(row => row.fromUserId === me || row.toUserId === me) ?? ledger.suggestions[0];
  const name = (id: string) => id === me ? 'You' : ledger.members.find(member => member.userId === id)?.displayName ?? 'Member';
  return <section className="next-transfer" aria-label="Next suggested transfer">
    <span className="eyebrow">{suggestion ? 'NEXT SUGGESTED TRANSFER' : 'CURRENT BALANCES'}</span>
    <h3>{suggestion ? 'One step closer to even.' : 'No repayments needed.'}</h3>
    {suggestion ? <>
      <p className="next-transfer-amount"><span>{name(suggestion.fromUserId)} → {name(suggestion.toUserId)}</span><strong>{money(suggestion.amountCents)}</strong></p>
      <p className="next-transfer-help">Suggested transfer, made outside ShareTally.</p>
    </> : <p className="next-transfer-help">Every member’s balance is zero.</p>}
    {ledger.incompleteBillIds.length > 0 && <p className="next-transfer-help">{ledger.incompleteBillIds.length} incomplete {ledger.incompleteBillIds.length === 1 ? 'bill' : 'bills'} excluded.</p>}
    <Button variant="secondary" onClick={viewRepayments}>View repayments <Icon name="diagonal" /></Button>
  </section>;
}
