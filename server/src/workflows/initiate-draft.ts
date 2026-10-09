import { z } from 'zod';
import { db } from '../db/index.js';
import { moveDraftNotePhotos } from '../note-photos/note-photos.js';
import { notifyGroupChanged } from '../realtime/group-events.js';
import { publishDraft } from '../receipts/drafts/initiation.js';
import { checked, revisionInput } from '../receipts/receipt-input.js';

// Bill initiation: the draft becomes a bill and its note photos move with it,
// in their order, in one transaction. A repeat finds them already moved.
export async function initiateDraft(id: string, userId: string, body: unknown) {
  const { revision } = checked(z.object({ revision: revisionInput }).strict(), body);
  const bill = await db.transaction(async tx => {
    const published = await publishDraft(tx, id, userId, revision);
    await moveDraftNotePhotos(tx, id, published.id);
    return published;
  });
  notifyGroupChanged(bill.groupId);
  return bill.id;
}
