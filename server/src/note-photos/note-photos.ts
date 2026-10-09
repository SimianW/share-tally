import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { NotePhoto } from "@share-tally/domain/contracts/bills";
import { lockedBill } from "../bills/access.js";
import { db } from "../db/index.js";
import { bills, notePhotos, receiptDrafts } from "../db/schema.js";
import type { Transaction as Tx } from "../db/types.js";
import { requireMember } from "../groups/group-access.js";
import { notifyGroupChanged } from "../realtime/group-events.js";
import { ownDraft, unlocked } from "../receipts/drafts/access.js";
import { checked } from "../receipts/receipt-input.js";
import { BillError } from "../shared/bill-error.js";
import { normalizeNotePhoto } from "./note-photo-image.js";

// Note photos change no amount, share, claim or confirmation (ADR-0019), so
// none of these operations touches a bill or draft revision.
const LIMIT = 3;
const descriptor = { id: notePhotos.id, position: notePhotos.position };
// Base64 of the largest accepted photo, plus room for the server to answer 413.
const uploadInput = z.object({ base64: z.string().max(2_200_000) }).strict();
type Owner = { draftId: string } | { billId: string };

const notFound = () => new BillError(404, "Photo not found.");
// Answers every hidden photo alike, so a response never reveals that one exists.
const hidden = <T>(access: Promise<T>) => access.catch((error: unknown) => {
  throw error instanceof BillError && error.status === 404 ? notFound() : error;
});

function billAccepts(bill: typeof bills.$inferSelect, userId: string) {
  if (bill.initiatorId !== userId)
    throw new BillError(403, "Only the initiator can change this bill's note photos.");
  if (bill.completedAt)
    throw new BillError(409, "Completed bills are final and cannot be changed.");
  if (bill.canceledAt) throw new BillError(409, "This bill is canceled.");
}

// The caller holds the owner's row lock, so concurrent uploads count in turn.
async function insert(tx: Tx, owner: Owner, bytes: Buffer): Promise<NotePhoto> {
  const column = "draftId" in owner ? notePhotos.draftId : notePhotos.billId;
  const [held] = await tx
    .select({ count: sql<number>`count(*)::int`, last: sql<number | null>`max(${notePhotos.position})` })
    .from(notePhotos)
    .where(eq(column, "draftId" in owner ? owner.draftId : owner.billId));
  if (held!.count >= LIMIT)
    throw new BillError(409, "A bill can have up to three note photos. Remove one to add another.");
  const [photo] = await tx
    .insert(notePhotos)
    .values({ ...owner, position: (held!.last ?? -1) + 1, bytes })
    .returning(descriptor);
  return photo!;
}

export async function addDraftNotePhoto(draftId: string, userId: string, body: unknown) {
  const { base64 } = checked(uploadInput, body);
  // Check ownership before decoding image bytes.
  await db.transaction(async (tx) => unlocked(await ownDraft(tx, draftId, userId)));
  const bytes = await normalizeNotePhoto(base64);
  // A draft is its initiator's alone, so no group is notified.
  return db.transaction(async (tx) => {
    unlocked(await ownDraft(tx, draftId, userId, true));
    return insert(tx, { draftId }, bytes);
  });
}

export async function addBillNotePhoto(billId: string, userId: string, body: unknown) {
  const { base64 } = checked(uploadInput, body);
  await db.transaction(async (tx) => billAccepts(await lockedBill(tx, billId, userId), userId));
  const bytes = await normalizeNotePhoto(base64);
  const { photo, groupId } = await db.transaction(async (tx) => {
    const bill = await lockedBill(tx, billId, userId);
    billAccepts(bill, userId);
    return { photo: await insert(tx, { billId }, bytes), groupId: bill.groupId };
  });
  notifyGroupChanged(groupId);
  return photo;
}

export async function removeNotePhoto(id: string, userId: string) {
  const [owner] = await db
    .select({ draftId: notePhotos.draftId, billId: notePhotos.billId })
    .from(notePhotos)
    .where(eq(notePhotos.id, id));
  if (!owner) throw notFound();
  const groupId = await db.transaction(async (tx) => {
    let groupId: string | null = null;
    // Initiation may move a draft's photo meanwhile; the locked draft then refuses.
    if (owner.draftId) unlocked(await hidden(ownDraft(tx, owner.draftId, userId, true)));
    else {
      const bill = await hidden(lockedBill(tx, owner.billId!, userId));
      billAccepts(bill, userId);
      groupId = bill.groupId;
    }
    const [deleted] = await tx.delete(notePhotos).where(and(eq(notePhotos.id, id), owner.draftId
      ? eq(notePhotos.draftId, owner.draftId) : eq(notePhotos.billId, owner.billId!))).returning(descriptor);
    if (!deleted) throw notFound();
    return groupId;
  });
  if (groupId) notifyGroupChanged(groupId);
}

// A draft's photos are its initiator's; a bill's are its group's.
export async function notePhotoBytes(id: string, userId: string) {
  return db.transaction(async (tx) => {
    const [photo] = await tx
      .select({
        bytes: notePhotos.bytes,
        draftInitiatorId: receiptDrafts.initiatorId,
        groupId: sql<string | null>`coalesce(${receiptDrafts.groupId}, ${bills.groupId})`,
      })
      .from(notePhotos)
      .leftJoin(receiptDrafts, eq(receiptDrafts.id, notePhotos.draftId))
      .leftJoin(bills, eq(bills.id, notePhotos.billId))
      .where(eq(notePhotos.id, id));
    if (!photo?.groupId || (photo.draftInitiatorId !== null && photo.draftInitiatorId !== userId))
      throw notFound();
    await hidden(requireMember(tx, photo.groupId, userId));
    return photo.bytes;
  });
}

// Reads for callers that already authorized these drafts or bills.
export async function draftNotePhotos(tx: Tx, draftId: string): Promise<NotePhoto[]> {
  return tx.select(descriptor).from(notePhotos)
    .where(eq(notePhotos.draftId, draftId)).orderBy(asc(notePhotos.position));
}
export async function billNotePhotos(tx: Tx, billIds: string[]) {
  const rows = billIds.length ? await tx
    .select({ ...descriptor, billId: notePhotos.billId })
    .from(notePhotos)
    .where(inArray(notePhotos.billId, billIds))
    .orderBy(asc(notePhotos.position)) : [];
  const byBill = new Map<string, NotePhoto[]>();
  for (const { billId, ...photo } of rows) byBill.set(billId!, [...byBill.get(billId!) ?? [], photo]);
  return byBill;
}

// Within initiation, which holds the draft's lock; positions keep their order.
export async function moveDraftNotePhotos(tx: Tx, draftId: string, billId: string) {
  await tx.update(notePhotos).set({ draftId: null, billId }).where(eq(notePhotos.draftId, draftId));
}

// The caller holds the group lock, which every note photo writer takes first.
export async function purgeGroupNotePhotos(tx: Tx, groupId: string) {
  await tx.delete(notePhotos).where(or(
    inArray(notePhotos.draftId, tx.select({ id: receiptDrafts.id }).from(receiptDrafts).where(eq(receiptDrafts.groupId, groupId))),
    inArray(notePhotos.billId, tx.select({ id: bills.id }).from(bills).where(eq(bills.groupId, groupId))),
  ));
}
