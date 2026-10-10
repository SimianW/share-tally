import type { MemberDepartureReason } from '@share-tally/domain/contracts/groups';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** Conflict metadata must match departure (not group-deletion) reason payloads. */
export function departureReasons(value: unknown): value is MemberDepartureReason[] {
  return Array.isArray(value) && value.length > 0 && value.every(reason => {
    if (!record(reason)) return false;
    switch (reason.code) {
      case 'nonzero_balance':
        return Number.isSafeInteger(reason.netCents) && reason.netCents !== 0;
      case 'incomplete_bills':
        return Array.isArray(reason.bills) && reason.bills.length > 0 && reason.bills.every(bill =>
          record(bill) && typeof bill.id === 'string' && typeof bill.title === 'string' &&
          (bill.role === 'initiator' || bill.role === 'participant'));
      case 'pending_repayments':
        return Array.isArray(reason.repayments) && reason.repayments.length > 0 && reason.repayments.every(repayment =>
          record(repayment) && typeof repayment.id === 'string' && typeof repayment.senderId === 'string' &&
          typeof repayment.recipientId === 'string' && Number.isSafeInteger(repayment.amountCents) && Number(repayment.amountCents) > 0);
      case 'sole_member':
        return true;
      default:
        return false;
    }
  });
}
