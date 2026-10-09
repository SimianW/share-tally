import { and, eq, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { db } from "../../db/index.js";
import { groupMembers, receiptDrafts, receiptPhotos } from "../../db/schema.js";
import { lockGroupForMember, requireMember } from '../../groups/group-access.js';
import { notifyGroupChanged } from "../../realtime/group-events.js";
import { BillError } from "../../shared/bill-error.js";
import { normalizeReceiptPhoto } from "../photos/receipt-photo.js";
import { printedTax } from "../pricing/frozen-receipt-pricing.js";
import { priceDraft } from "../pricing/receipt-pricing.js";
import { checked, draftInput, revisionInput, withoutLegacyShare, type ReceiptDraftData } from "../receipt-input.js";
import { itemWasEdited } from "../receipt-needs-check.js";
import { editable, ownDraft } from './access.js';
import { storePhoto } from './photos.js';
import { readDraft } from './queries.js';
import { draftNotePhotos } from '../../note-photos/note-photos.js';
// A client cannot clear (or invent) a review marker by merely echoing a flag.
// New manual rows without scan evidence only need review for a missing price.
function preserveReviewFlags(items: ReceiptDraftData["items"], previous: ReceiptDraftData["items"] = []) {
  const byId = new Map(previous.map((item) => [item.id, item]));
  return items.map((item) => {
    const old = byId.get(item.id);
    const { needsCheck: _clientFlag, taxNotChecked: _clientTaxFlag, ...fields } = item;
    const needsCheck = !old
      ? item.amountCents === null
      : itemWasEdited(old, item) ? false
      : old.needsCheck ?? (old.amountCents === null ? true : undefined);
    const taxNotChecked = !old ? item.taxNotChecked
      : old.taxable !== item.taxable ? false : old.taxNotChecked;
    return {
      ...fields,
      ...(taxNotChecked === undefined ? {} : { taxNotChecked }),
      ...(needsCheck === undefined ? {} : { needsCheck }),
    };
  });
}

export async function saveDraft(
  groupId: string,
  userId: string,
  id: string,
  body: unknown,
) {
  const input = checked(
    z
      .object({
        revision: z.number().int().min(0),
        data: draftInput,
        photoBase64: z.string().max(11_184_812).optional(),
      })
      .strict(),
    body,
  );
  if (
    new Set(input.data.items.map((i) => i.id)).size !== input.data.items.length
  )
    throw new BillError(400, "Item IDs must be unique.");
  // Canonicalize before the idempotency comparison as well as persistence.
  // A supplied final cost matters only when its manual override is enabled.
  input.data.items = priceDraft(input.data).items;
  if (input.data.receipt) {
    const { taxLabel: _submitted, ...receipt } = input.data.receipt;
    const label = printedTax(receipt.evidence)?.label;
    input.data.receipt = { ...receipt, ...(label ? { taxLabel: label } : {}) };
  }
  await db.transaction((tx) => requireMember(tx, groupId, userId));
  const photo =
    input.photoBase64 === undefined
      ? undefined
      : await normalizeReceiptPhoto(input.photoBase64);
  return db.transaction(async (tx) => {
    await lockGroupForMember(tx, groupId, userId);
    const [old] = await tx
      .select()
      .from(receiptDrafts)
      .where(eq(receiptDrafts.id, id))
      .for("update");
    if (old) {
      if (old.initiatorId !== userId || old.groupId !== groupId)
        throw new BillError(404, "Draft not found.");
      if (old.processingStatus === "processing") editable(old, input.revision);
      input.data.items = preserveReviewFlags(input.data.items, old.data.items);
      const [oldPhoto] = await tx
        .select({
          expiresAt: receiptPhotos.expiresAt,
          base64:
            photo === undefined
              ? sql<string | null>`null`
              : receiptPhotos.base64,
        })
        .from(receiptPhotos)
        .where(eq(receiptPhotos.draftId, id));
      if (
        !old.billId &&
        isDeepStrictEqual(withoutLegacyShare(old.data), input.data) &&
        (photo === undefined || oldPhoto?.base64 === photo.toString("base64"))
      )
        return {
          ...old,
          data: withoutLegacyShare(old.data),
          photo: oldPhoto
            ? {
                expiresAt: oldPhoto.expiresAt,
                expired: oldPhoto.expiresAt <= new Date(),
              }
            : null,
          notePhotos: await draftNotePhotos(tx, id),
        };
      editable(old, input.revision);
      const [updated] = await tx
        .update(receiptDrafts)
        .set({
          data: input.data,
          revision: old.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(receiptDrafts.id, id))
        .returning();
      if (photo) await storePhoto(tx, id, photo);
      const [savedPhoto] = await tx
        .select({ expiresAt: receiptPhotos.expiresAt })
        .from(receiptPhotos)
        .where(eq(receiptPhotos.draftId, id));
      const [current] = photo
        ? await tx.select().from(receiptDrafts).where(eq(receiptDrafts.id, id))
        : [updated!];
      return {
        ...current!,
        photo: savedPhoto
          ? { ...savedPhoto, expired: savedPhoto.expiresAt <= new Date() }
          : null,
        notePhotos: await draftNotePhotos(tx, id),
      };
    }
    if (input.revision !== 0)
      throw new BillError(409, "Draft not found. Start a new draft.");
    input.data.items = preserveReviewFlags(input.data.items);
    const [row] = await tx
      .insert(receiptDrafts)
      .values({ id, groupId, initiatorId: userId, data: input.data })
      .onConflictDoNothing()
      .returning();
    if (!row)
      throw new BillError(409, "Draft ID already used. Start a new draft.");
    if (photo) await storePhoto(tx, id, photo);
    const [savedPhoto] = await tx
      .select({ expiresAt: receiptPhotos.expiresAt })
      .from(receiptPhotos)
      .where(eq(receiptPhotos.draftId, id));
    return {
      ...row,
      photo: savedPhoto ? { ...savedPhoto, expired: false } : null,
      notePhotos: [],
    };
  });
}
export async function confirmDraftItem(id: string, itemId: string, userId: string, body: unknown) {
  const { revision, flag } = checked(z.object({
    revision: revisionInput,
    flag: z.enum(["needsCheck", "taxNotChecked"]),
  }).strict(), body);
  const result = await db.transaction(async (tx) => {
    const draft = await ownDraft(tx, id, userId, true);
    editable(draft, revision);
    const item = draft.data.items.find((entry) => entry.id === itemId);
    if (!item) throw new BillError(404, "Item not found.");
    if (item[flag] === false)
      return { groupId: draft.groupId, changed: false };
    const data: ReceiptDraftData = { ...draft.data, items: draft.data.items.map((entry) =>
      entry.id === itemId ? { ...entry, [flag]: false } : entry,
    ) };
    await tx.update(receiptDrafts).set({
      data, revision: draft.revision + 1, updatedAt: new Date(),
    }).where(eq(receiptDrafts.id, id));
    return { groupId: draft.groupId, changed: true };
  });
  if (result.changed) notifyGroupChanged(result.groupId);
  return readDraft(id, userId);
}

export async function deleteDraft(id: string, userId: string, body: unknown) {
  const { revision } = checked(
    z.object({ revision: revisionInput }).strict(),
    body,
  );
  await db.transaction(async (tx) => {
    const [scope] = await tx.select({ groupId: receiptDrafts.groupId }).from(receiptDrafts)
      .innerJoin(groupMembers, and(eq(groupMembers.groupId, receiptDrafts.groupId), eq(groupMembers.userId, userId)))
      .where(eq(receiptDrafts.id, id));
    if (!scope) return;
    await lockGroupForMember(tx, scope.groupId, userId);
    const [draft] = await tx
      .select()
      .from(receiptDrafts)
      .where(
        and(eq(receiptDrafts.id, id), eq(receiptDrafts.initiatorId, userId)),
      )
      .for("update");
    if (!draft) return; // Retry after a successful delete is harmless; do not disclose other owners.
    await requireMember(tx, draft.groupId, userId);
    editable(draft, revision);
    await tx.delete(receiptDrafts).where(eq(receiptDrafts.id, id));
  });
}

