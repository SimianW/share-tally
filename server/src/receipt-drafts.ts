import { RECEIPT_MODEL_TIMEOUT_MS } from "./receipt-names.js";
import type { extractionDefaults, ExtractedReceipt } from "./receipt-extraction.js";
import { applyReceiptModelResult } from "./receipt-processing.js";
import { isDeepStrictEqual } from "node:util";
import { and, eq, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db/index.js";
import { normalizeReceiptPhoto } from "./receipt-photo.js";
import {
  receiptDrafts,
  receiptPhotos,
  receiptEvidence,
  groupMembers,
  groups,
  bills,
  billShares,
  billItems,
} from "./db/schema.js";
import {
  checked,
  draftInput,
  itemInput,
  revisionInput,
  type ReceiptDraftData,
} from "./receipt-input.js";
import { BillError, parseBill } from "./bills.js";
import type { Tx } from "./item-accounting.js";
import { notifyGroupChanged } from "./group-events.js";
import { priceDraft } from "./receipt-pricing.js";
import { frozenBases, roundingOffset, printedTax, selectFrozenTaxRate } from "./frozen-receipt-pricing.js";
import { itemWasEdited } from "./receipt-needs-check.js";
export async function requireMember(tx: Tx, groupId: string, userId: string) {
  const [m] = await tx
    .select()
    .from(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
    );
  if (!m) throw new BillError(404, "Group not found.");
}
export async function ownDraft(
  tx: Tx,
  id: string,
  userId: string,
  lock = false,
) {
  const query = tx
    .select()
    .from(receiptDrafts)
    .where(
      and(eq(receiptDrafts.id, id), eq(receiptDrafts.initiatorId, userId)),
    );
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new BillError(404, "Draft not found.");
  await requireMember(tx, row.groupId, userId);
  return row;
}
export function editable(row: typeof receiptDrafts.$inferSelect, revision: number) {
  if (row.processingStatus === "processing")
    throw new BillError(409, "Receipt is checking names and tax. Please wait.");
  if (row.billId)
    throw new BillError(409, "This draft has already been initialized.");
  if (row.revision !== revision)
    throw new BillError(
      409,
      "This draft changed in another window. Reopen it to review the saved version.",
    );
}
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
    await tx.select().from(groups).where(eq(groups.id, groupId)).for("update");
    await requireMember(tx, groupId, userId);
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
        isDeepStrictEqual(old.data, input.data) &&
        (photo === undefined || oldPhoto?.base64 === photo.toString("base64"))
      )
        return {
          ...old,
          photo: oldPhoto
            ? {
                expiresAt: oldPhoto.expiresAt,
                expired: oldPhoto.expiresAt <= new Date(),
              }
            : null,
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
export async function listDrafts(groupId: string, userId: string) {
  await db.transaction((tx) => requireMember(tx, groupId, userId));
  await sweepStaleProcessingDrafts({ groupId, userId });
  return db.transaction(async (tx) => {
    await requireMember(tx, groupId, userId);
    return tx
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
    };
  });
}
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
export async function initializeDraft(
  id: string,
  userId: string,
  body: unknown,
) {
  const { revision } = checked(
    z.object({ revision: revisionInput }).strict(),
    body,
  );
  const result = await db.transaction(async (tx) => {
    const draft = await ownDraft(tx, id, userId, true);
    if (draft.billId) return { id: draft.billId, groupId: draft.groupId };
    editable(draft, revision);
    const reviewed = checked(draftInput, draft.data);
    const { mode, items: _draftItems, receipt: _receipt, ...data } = reviewed;
    const priced = mode === "items" ? priceDraft(reviewed).items : [];
    const bases = frozenBases({ ...reviewed, items: priced });
    const printed = printedTax(reviewed.receipt?.evidence);
    const receipt = mode === "items" ? {
      subtotalCents: reviewed.receipt?.subtotalCents ?? null,
      discountCents: reviewed.receipt?.discountCents ?? 0,
      taxCents: reviewed.receipt?.taxCents ?? 0,
      extraCents: reviewed.receipt?.extraCents ?? 0,
      pricesIncludeTax: reviewed.receipt?.pricesIncludeTax ?? false,
      totalCents: reviewed.totalCents!,
      ...(printed ? { taxLabel: printed.label, printedTaxRate: printed.rate } : {}),
    } : null;
    const rate = receipt && selectFrozenTaxRate(receipt, bases.taxableBase ?? 0);
    const items =
      mode === "items"
        ? checked(
            z.array(itemInput.extend({ taxCents: itemInput.shape.taxCents.nullable(), extraCents: itemInput.shape.extraCents.nullable() })).min(1).max(200),
            // Publish only bill-item fields, not draft-only derivations, fallback
            // markers, discount provenance or Azure evidence.
            priced.map((item) => ({
              id: item.id, name: item.name, originalText: item.originalText,
              quantity: item.quantity, amountCents: item.amountCents,
              discountCents: item.discountCents, finalCents: item.finalCents,
              taxCents: item.allocatedTaxCents,
              extraCents: item.allocatedExtraCents,
            })),
          )
        : [];
    const input = parseBill({
      ...data,
      ownShareCents: mode === "items" ? 0 : data.ownShareCents,
      requestId: id,
    });
    if (!input.participantIds.includes(userId))
      throw new BillError(400, "The initiator must be included.");
    const members = await tx
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, draft.groupId));
    if (
      input.participantIds.some((id) => !members.some((m) => m.userId === id))
    )
      throw new BillError(400, "Select members of this group.");
    if (
      mode === "items" &&
      (!items.length || items.reduce((s, i) => s + i.finalCents, 0) > 1_000_000)
    )
      throw new BillError(
        400,
        "Add at least one item. The item total must not exceed CAD 10,000.",
      );
    const [bill] = await tx
      .insert(bills)
      .values({
        ...input,
        groupId: draft.groupId,
        initiatorId: userId,
        mode,
        receipt,
        frozenTaxBaseCents: bases.taxableBase,
        frozenDiscountBaseCents: bases.discountBase,
        frozenExtraBaseCents: bases.extraBase,
        requestPayload: JSON.stringify(draft.data),
      })
      .returning();
    await tx.insert(billShares).values(
      input.participantIds.map((uid) => ({
        billId: bill!.id,
        userId: uid,
        amountCents:
          mode === "manual" && uid === userId ? input.ownShareCents : null,
        confirmedAt: mode === "manual" && uid === userId ? new Date() : null,
      })),
    );
    if (mode === "items")
      await tx.insert(billItems).values(
        items.map((item, position) => {
          const source = priced[position]!;
          const base = item.amountCents - item.discountCents;
          const net = source.allocatedDiscountCents === null ? null : base - source.allocatedDiscountCents!;
          return {
            ...item, billId: bill!.id, position,
            taxable: source.taxable !== false,
            manualFinal: source.manualFinal,
            allocatedDiscountCents: source.allocatedDiscountCents,
            frozenDiscountWeightCents: base,
            frozenNetWeightCents: net,
            frozenDiscountRoundingCents: roundingOffset(source.allocatedDiscountCents ?? null, receipt!.discountCents, base, bases.discountBase),
            frozenTaxRoundingCents: roundingOffset(source.allocatedTaxCents ?? null, receipt!.pricesIncludeTax ? 0 : (rate?.taxCents ?? receipt!.taxCents), source.taxable === false ? 0 : net, rate?.taxableBaseCents ?? null),
            frozenExtraRoundingCents: roundingOffset(source.allocatedExtraCents ?? null, receipt!.extraCents, net, bases.extraBase),
          };
        }),
      );
    if (
      mode === "manual" &&
      input.participantIds.length === 1 &&
      input.totalCents - input.ownShareCents <= 5
    )
      await tx
        .update(bills)
        .set({
          completedAt: new Date(),
          adjustmentCents: input.totalCents - input.ownShareCents,
        })
        .where(eq(bills.id, bill!.id));
    await tx
      .update(receiptDrafts)
      .set({ billId: bill!.id, revision: draft.revision + 1 })
      .where(eq(receiptDrafts.id, id));
    return { id: bill!.id, groupId: draft.groupId };
  });
  notifyGroupChanged(result.groupId);
  return result.id;
}
function withoutEvidence(data: typeof receiptDrafts.$inferSelect.data) {
  const { evidence: _receiptEvidence, taxLabel: _taxLabel, ...receipt } = data.receipt ?? {};
  return {
    ...data,
    ...(data.receipt ? { receipt: receipt as NonNullable<typeof data.receipt> } : {}),
    items: data.items.map(({ evidence: _itemEvidence, ...item }) => item),
  };
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

async function storePhoto(tx: Tx, id: string, bytes: Buffer) {
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

// Persist the Azure result and its evidence under the same revision check. The
// model never runs against a draft that changed while Azure was reading it.
export async function saveProcessingDraft(
  id: string,
  userId: string,
  revision: number,
  extraction: ReturnType<typeof extractionDefaults>,
  analysis: ExtractedReceipt["rawAnalysis"],
) {
  const result = await db.transaction(async (tx) => {
    const old = await ownDraft(tx, id, userId, true);
    editable(old, revision);
    const [photo] = await tx.select({ expiresAt: receiptPhotos.expiresAt })
      .from(receiptPhotos).where(eq(receiptPhotos.draftId, id));
    if (!photo || photo.expiresAt <= new Date())
      throw new BillError(409, "Receipt photo expired during scanning.");
    // Replace rather than retain an earlier scan's evidence when an adapter
    // supplies no analysis (for example a test or manually entered receipt).
    await tx.delete(receiptEvidence).where(eq(receiptEvidence.draftId, id));
    if (analysis) await tx.insert(receiptEvidence).values({ draftId: id, analysis });
    const now = new Date();
    const label = printedTax(extraction.receipt.evidence)?.label;
    const [draft] = await tx.update(receiptDrafts).set({
      data: checked(draftInput, {
        ...old.data,
        mode: "items",
        title: old.data.title || extraction.title,
        items: extraction.items,
        receipt: { ...extraction.receipt, ...(label ? { taxLabel: label } : {}) },
        totalCents: extraction.totalCents,
      }),
      processingStatus: "processing",
      processingStartedAt: now,
      revision: old.revision + 1,
      updatedAt: now,
    }).where(eq(receiptDrafts.id, id)).returning();
    return { ...draft!, photo: { ...photo, expired: false } };
  });
  notifyGroupChanged(result.groupId);
  return result;
}

export { RECEIPT_MODEL_TIMEOUT_MS } from "./receipt-names.js";

// Holding the row lock lets either the model or recovery complete this scan,
// never both. The start time identifies the processing operation.
export async function completeProcessingDraft(
  id: string,
  startedAt: Date,
  attempt: Parameters<typeof applyReceiptModelResult>[1],
) {
  const result = await db.transaction(async (tx) => {
    const [draft] = await tx.select().from(receiptDrafts)
      .where(eq(receiptDrafts.id, id)).for("update");
    if (!draft || draft.processingStatus !== "processing" ||
        draft.processingStartedAt?.getTime() !== startedAt.getTime()) return null;
    const expired = Date.now() - startedAt.getTime() >= RECEIPT_MODEL_TIMEOUT_MS;
    const receipt = draft.data.receipt;
    const applied = applyReceiptModelResult(draft.data.items, expired ? { kind: "timeout" } : attempt,
      receipt && { taxCents: receipt.taxCents, subtotalCents: receipt.subtotalCents, totalCents: draft.data.totalCents });
    const data: ReceiptDraftData = { ...draft.data, items: applied.items };
    // Reallocate the same Azure tax, never change the receipt's amounts.
    data.items = priceDraft(data).items;
    await tx.update(receiptDrafts).set({
      data,
      processingStatus: applied.fellBack ? "fallback" : "ready",
      processingStartedAt: null,
      revision: draft.revision + 1,
      updatedAt: new Date(),
    }).where(eq(receiptDrafts.id, id));
    return { groupId: draft.groupId, outcome: applied.outcome, reason: applied.reason };
  });
  if (result) notifyGroupChanged(result.groupId);
  return result;
}

export async function sweepStaleProcessingDrafts(
  scope: { id?: string; groupId?: string; userId?: string } = {},
) {
  const stale = await db.select({ id: receiptDrafts.id, startedAt: receiptDrafts.processingStartedAt })
    .from(receiptDrafts).where(and(
      eq(receiptDrafts.processingStatus, "processing"),
      lte(receiptDrafts.processingStartedAt, new Date(Date.now() - RECEIPT_MODEL_TIMEOUT_MS)),
      scope.id ? eq(receiptDrafts.id, scope.id) : undefined,
      scope.groupId ? eq(receiptDrafts.groupId, scope.groupId) : undefined,
      scope.userId ? eq(receiptDrafts.initiatorId, scope.userId) : undefined,
    ));
  for (const draft of stale) {
    if (!draft.startedAt) continue;
    const result = await completeProcessingDraft(draft.id, draft.startedAt, { kind: "timeout" });
    if (result) console.info("Receipt processing recovered", {
      outcome: result.outcome, reason: result.reason,
      elapsedMs: Date.now() - draft.startedAt.getTime(),
    });
  }
}
