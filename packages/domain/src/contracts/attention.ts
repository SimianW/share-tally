
export type AttentionAction = { groupId: string; groupName: string } & (
  | { kind: 'missing-share' | 'confirm-share'; billId: string; title: string; amountCents: number | null; mode: 'manual' | 'items' }
  | { kind: 'review-repayment'; repaymentId: string; senderName: string; amountCents: number }
  | { kind: 'review-draft'; draftId: string; title: string; processingStatus: 'ready' | 'fallback'; amountCents: number | null }
);
