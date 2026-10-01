import { money, type GroupLedger } from './bill-api';

type Suggestion = GroupLedger['suggestions'][number];
type People = { me: { id: string }; name: (id: string) => string };

// Sentence forms for a member, so that "you" reads naturally wherever the viewer
// appears: "You owe Carl" / "Yiming owes you".
export function wording({ me, name }: People) {
  return {
    subject: name,
    object: (id: string) => id === me.id ? 'you' : name(id),
    verb: (id: string, base: string) => id === me.id ? base : `${base}s`,
  };
}

// One sentence on why a suggested transfer differs from what its payer directly
// owes its recipient, or null when nothing is passed along. A person is named
// only together with their actual direct debt; otherwise the reason stays generic.
export function transferReason(suggestion: Suggestion, ledger: Pick<GroupLedger, 'suggestions' | 'directDebts'>, people: People) {
  const { directDebts, suggestions } = ledger;
  const { fromUserId: payer, toUserId: recipient } = suggestion;
  const passed = suggestion.explanation.passedAlongCents;
  if (!passed) return null;
  const n = money(Math.abs(passed));
  const { subject, object, verb } = wording(people);
  const debt = (from: string, to: string) =>
    directDebts.find(pair => pair.fromUserId === from && pair.toUserId === to)?.amountCents ?? 0;
  const others = [...new Set(directDebts.flatMap(pair => [pair.fromUserId, pair.toUserId]))]
    .filter(id => id !== payer && id !== recipient);
  if (passed > 0) {
    const via = others.find(id => debt(id, recipient) === passed && debt(payer, id) >= passed);
    if (via) {
      // The rule also accepts a payer debt equal to the amount passed along.
      const more = debt(payer, via) > passed ? 'more than that' : 'the same amount';
      return `${subject(via)} owed ${object(recipient)} ${n}. ${subject(payer)} ${verb(payer, 'owe')} ${object(via)} ${more}, `
        + `so ${object(payer)} ${verb(payer, 'pay')} it to ${object(recipient)} directly — one fewer transfer.`;
    }
    return `${n} of other debts is passed along to ${object(recipient)} so the group needs fewer transfers.`;
  }
  // "Pays that to X instead" must describe a real suggested transfer: in a debt
  // cycle the recipient's debt to X can be cancelled out rather than paid.
  const via = others.find(id => debt(recipient, id) === -passed
    && suggestions.some(other => other.fromUserId === payer && other.toUserId === id && other.amountCents >= -passed));
  if (via) return `${subject(recipient)} owed ${object(via)} ${n}. ${subject(payer)} ${verb(payer, 'pay')} that to ${object(via)} instead, `
    + `so ${object(recipient)} ${verb(recipient, 'receive')} ${n} less here.`;
  return `${n} is sent elsewhere so the group needs fewer transfers.`;
}
