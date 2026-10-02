
export type Repayment = {
  id: string; groupId: string; senderId: string; recipientId: string;
  amountCents: number; status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string; decidedAt: string | null;
};
export type RepaymentDraft = { requestId: string; recipientId: string; amountCents: number };
// Starting values for Record repayment, e.g. from a suggested transfer.
export type RepaymentPrefill = Omit<RepaymentDraft, 'requestId'>;
