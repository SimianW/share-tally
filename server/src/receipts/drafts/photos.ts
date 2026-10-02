import { requireMember } from '../../groups/group-access.js';
import { editable, ownDraft } from './access.js';
import { withoutEvidence } from './evidence.js';
import { and, eq, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import { normalizeReceiptPhoto } from "../photos/receipt-photo.js";
import { receiptDrafts, receiptEvidence, receiptPhotos } from "../../db/schema.js";
import { checked, revisionInput } from "../receipt-input.js";
import { BillError } from "../../shared/bill-error.js";
import type { Transaction as Tx } from "../../db/types.js";

export async function uploadPhoto(id: string, userId: string, body: unknown) {
  const input = checked(
    z
      .object({ revision: revisionInput, base64: z.string().max(11_184_812) })
      .strict(),
    body,
  );
  // Check ownership before decoding image bytes.
  await db.transaction(async (tx) =>
    editable(await ownDraft(tx, id, userId), input.revision),
  );
  const bytes = await normalizeReceiptPhoto(input.base64);
  return db.transaction(async (tx) => {
    const draft = await ownDraft(tx, id, userId, true);
    editable(draft, input.revision);
    await storePhoto(tx, id, bytes);
    await tx
      .update(receiptDrafts)
      .set({ revision: draft.revision + 1, updatedAt: new Date() })
      .where(eq(receiptDrafts.id, id));
  });
}
export async function photoBytes(
  id: string,
  userId: string,
  ownerOnly = false,
) {
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(receiptDrafts)
      .where(eq(receiptDrafts.id, id));
    if (
      !draft ||
      ((!draft.billId || ownerOnly) && draft.initiatorId !== userId)
    )
      throw new BillError(404, "Photo not found.");
    await requireMember(tx, draft.groupId, userId);
    const [photo] = await tx
      .select()
      .from(receiptPhotos)
      .where(eq(receiptPhotos.draftId, id));
    if (!photo || !photo.base64 || photo.expiresAt <= new Date())
      throw new BillError(
        404,
        "No photo is available. Receipt photos expire after six months.",
      );
    return Buffer.from(photo.base64, "base64");
  });
}
export async function purgeExpiredPhotos() {
  await db.transaction(async (tx) => {
    const expired = await tx.select({ draftId: receiptPhotos.draftId })
      .from(receiptPhotos).where(and(
        lte(receiptPhotos.expiresAt, new Date()), ne(receiptPhotos.base64, ""),
      ));
    for (const { draftId } of expired) {
      const [draft] = await tx.select().from(receiptDrafts)
        .where(eq(receiptDrafts.id, draftId)).for("update");
      const [photo] = await tx.select({ expiresAt: receiptPhotos.expiresAt })
        .from(receiptPhotos).where(eq(receiptPhotos.draftId, draftId));
      if (draft && photo && photo.expiresAt <= new Date() &&
          (draft.data.receipt?.evidence || draft.data.items.some((item) => item.evidence)))
        await tx.update(receiptDrafts).set({
          data: withoutEvidence(draft.data),
          revision: draft.revision + 1,
          updatedAt: new Date(),
        }).where(eq(receiptDrafts.id, draftId));
    }
    // The evidence and photo become unavailable together, even for initialized bills.
    await tx.delete(receiptEvidence).where(
      sql`${receiptEvidence.draftId} in (select draft_id from receipt_photos where expires_at <= now())`,
    );
    await tx.update(receiptPhotos).set({ base64: "" }).where(
      and(lte(receiptPhotos.expiresAt, new Date()), ne(receiptPhotos.base64, "")),
    );
  });
}
export async function storePhoto(tx: Tx, id: string, bytes: Buffer) {
  const expiresAt = new Date();
  const day = expiresAt.getUTCDate();
  expiresAt.setUTCDate(1);
  expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 6);
  const lastDay = new Date(
    Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth() + 1, 0),
  ).getUTCDate();
  expiresAt.setUTCDate(Math.min(day, lastDay));
  await tx.delete(receiptEvidence).where(eq(receiptEvidence.draftId, id));
  // Replacing the photo invalidates evidence mapped from the previous image.
  const [draft] = await tx.select().from(receiptDrafts).where(eq(receiptDrafts.id, id));
  if (draft) await tx.update(receiptDrafts).set({ data: withoutEvidence(draft.data) })
    .where(eq(receiptDrafts.id, id));
  await tx
    .insert(receiptPhotos)
    .values({ draftId: id, base64: bytes.toString("base64"), expiresAt })
    .onConflictDoUpdate({
      target: receiptPhotos.draftId,
      set: {
        base64: bytes.toString("base64"),
        uploadedAt: new Date(),
        expiresAt,
      },
    });
}
