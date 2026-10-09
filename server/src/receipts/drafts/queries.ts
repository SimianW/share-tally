import { requireMember } from '../../groups/group-access.js';
import { ownDraft } from './access.js';
import { sweepStaleProcessingDrafts } from './processing.js';
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { receiptDrafts, receiptPhotos } from "../../db/schema.js";
import { withoutLegacyShare } from "../receipt-input.js";
import { draftNotePhotos } from "../../note-photos/note-photos.js";

export async function listDrafts(groupId: string, userId: string) {
  await db.transaction((tx) => requireMember(tx, groupId, userId));
  await sweepStaleProcessingDrafts({ groupId, userId });
  return db.transaction(async (tx) => {
    await requireMember(tx, groupId, userId);
    const drafts = await tx
      .select({
        id: receiptDrafts.id,
        data: receiptDrafts.data,
        revision: receiptDrafts.revision,
        updatedAt: receiptDrafts.updatedAt,
        processingStatus: receiptDrafts.processingStatus,
        processingStartedAt: receiptDrafts.processingStartedAt,
      })
      .from(receiptDrafts)
      .where(
        and(
          eq(receiptDrafts.groupId, groupId),
          eq(receiptDrafts.initiatorId, userId),
          isNull(receiptDrafts.billId),
        ),
      )
      .orderBy(receiptDrafts.updatedAt);
    return drafts.map((draft) => ({ ...draft, data: withoutLegacyShare(draft.data) }));
  });
}
export async function readDraft(id: string, userId: string) {
  await db.transaction((tx) => ownDraft(tx, id, userId));
  await sweepStaleProcessingDrafts({ id, userId });
  return db.transaction(async (tx) => {
    const draft = await ownDraft(tx, id, userId);
    const [photo] = await tx
      .select({ expiresAt: receiptPhotos.expiresAt })
      .from(receiptPhotos)
      .where(eq(receiptPhotos.draftId, id));
    return {
      ...draft,
      photo: photo
        ? { ...photo, expired: photo.expiresAt <= new Date() }
        : null,
      notePhotos: await draftNotePhotos(tx, id),
    };
  });
}
