

import { receiptDrafts } from "../../db/schema.js";

export function withoutEvidence(data: typeof receiptDrafts.$inferSelect.data) {
  const { evidence: _receiptEvidence, taxLabel: _taxLabel, ...receipt } = data.receipt ?? {};
  return {
    ...data,
    ...(data.receipt ? { receipt: receipt as NonNullable<typeof data.receipt> } : {}),
    items: data.items.map(({ evidence: _itemEvidence, ...item }) => item),
  };
}
