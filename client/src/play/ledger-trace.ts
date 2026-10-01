import { money, type GroupLedger, type LedgerEntry } from './bill-api';

// Shared by the desktop ledger table and the mobile explanation sheet. Both only
// arrange the server's ledger; neither calculates a balance or a transfer.
export type Suggestion = GroupLedger['suggestions'][number];
// What an explanation traces: a member, or the current suggestion for a pair.
export type Trace = { kind: 'member'; userId: string } | { kind: 'transfer'; suggestion: Suggestion };

export const minus = (cents: number) => `${cents < 0 ? '−' : ''}${money(Math.abs(cents))}`;
export const signed = (cents: number) => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(Math.abs(cents))}`;
export const tone = (cents: number) => cents > 0 ? 'group-tone-owed' : cents < 0 ? 'group-tone-owe' : '';
const shortDate = (date: Date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const localDay = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(n => String(n).padStart(2, '0')).join('-');
// Lines show when an entry took effect; a bill also notes a different purchase date.
export function entryDate(entry: LedgerEntry) {
  const effective = new Date(entry.kind === 'bill' ? entry.completedAt : entry.decidedAt);
  if (entry.kind === 'repayment' || localDay(effective) === entry.purchaseDate) return shortDate(effective);
  return `${shortDate(effective)} · bought ${shortDate(new Date(`${entry.purchaseDate}T12:00:00`))}`;
}

// Long histories show this many recent lines, with the earlier ones summed in one row.
const RECENT_ENTRIES = 10;
// Splits lines in effective order into the hidden earlier ones and the shown recent ones.
export function recentLines<T>(lines: T[], showAll: boolean) {
  const cut = showAll ? 0 : Math.max(0, lines.length - RECENT_ENTRIES);
  return { hidden: lines.slice(0, cut), shown: lines.slice(cut) };
}
export const entryCount = (count: number) => `${count} ${count === 1 ? 'entry' : 'entries'}`;
