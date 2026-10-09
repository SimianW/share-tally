import { db } from '../db/index.js';
import { lockGroupForCreator, markGroupDeleted, requireGroupDeletionEligibility } from '../groups/groups.js';
import { notifyGroupDeleted } from '../realtime/group-events.js';
import { purgeGroupReceiptDrafts } from '../receipts/drafts/deletion.js';
import { purgeGroupNotePhotos } from '../note-photos/note-photos.js';

export async function deleteGroup(groupId: string, userId: string) {
  const name = await db.transaction(async tx => {
    const group = await lockGroupForCreator(tx, groupId, userId);
    await requireGroupDeletionEligibility(tx, groupId, userId);
    await purgeGroupNotePhotos(tx, groupId);
    await purgeGroupReceiptDrafts(tx, groupId);
    await markGroupDeleted(tx, groupId);
    return group.name;
  });
  notifyGroupDeleted(groupId, name);
}
