import type { Repayment } from './repayments.js';

// One equal-and-opposite pair per confirmed record, shared by all balance views.
export function* confirmedRepaymentEntries(records: Repayment[]) {
  for (const record of records) {
    if (record.status !== 'confirmed') continue;
    const amountCents = BigInt(record.amountCents);
    yield { groupId: record.groupId, userId: record.senderId, amountCents };
    yield { groupId: record.groupId, userId: record.recipientId, amountCents: -amountCents };
  }
}
