import { and, eq, inArray, isNull } from 'drizzle-orm';
import { receiptDrafts, receiptEvidence, receiptPhotos } from '../../db/schema.js';
import type { Transaction as Tx } from '../../db/types.js';
import { withoutEvidence } from './evidence.js';

// Caller holds the group row lock, so no new draft or financial write can
// enter the group while these records are purged.
export async function purgeGroupReceiptDrafts(tx: Tx, groupId: string) {
  // Lock drafts before their evidence/photos, matching the order used by
  // photo expiry and processing completion. Initiated drafts keep receipt
  // text behind preserved bills; uninitiated drafts are voided altogether.
  const drafts = await tx.select().from(receiptDrafts)
    .where(eq(receiptDrafts.groupId, groupId)).orderBy(receiptDrafts.id).for('update');
  if (drafts.length) {
    const ids = drafts.map(draft => draft.id);
    for (const draft of drafts) {
      if (draft.billId) await tx.update(receiptDrafts)
        .set({ data: withoutEvidence(draft.data) }).where(eq(receiptDrafts.id, draft.id));
    }
    await tx.delete(receiptEvidence).where(inArray(receiptEvidence.draftId, ids));
    await tx.delete(receiptPhotos).where(inArray(receiptPhotos.draftId, ids));
  }
  await tx.delete(receiptDrafts).where(and(eq(receiptDrafts.groupId, groupId), isNull(receiptDrafts.billId)));
}
