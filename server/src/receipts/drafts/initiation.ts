import { editable, ownDraft } from './access.js';
import { eq } from "drizzle-orm";
import { z } from "zod";
import { billItems, bills, billShares, groupMembers, receiptDrafts } from "../../db/schema.js";
import { checked, draftInput, itemInput } from "../receipt-input.js";
import type { Transaction as Tx } from "../../db/types.js";
import { BillError } from "../../shared/bill-error.js";
import { parseBill } from "../../bills/inputs.js";
import { priceDraft, unassignedReceiptTaxMessage } from "../pricing/receipt-pricing.js";
import { frozenBases, printedTax, roundingOffset, selectFrozenTaxRate } from "../pricing/frozen-receipt-pricing.js";

// Publishes the draft as a bill within the caller's transaction. Repeating it
// for an initiated draft returns that bill.
export async function publishDraft(tx: Tx, id: string, userId: string, revision: number) {
  const draft = await ownDraft(tx, id, userId, true);
  if (draft.billId) return { id: draft.billId, groupId: draft.groupId };
  editable(draft, revision);
  const reviewed = checked(draftInput, draft.data);
  const taxError = unassignedReceiptTaxMessage(reviewed);
  if (taxError) throw new BillError(400, taxError);
  const { mode, items: _draftItems, receipt: _receipt, ...data } = reviewed;
  const priced = mode === "items" ? priceDraft(reviewed).items : [];
  // An item draft without a total paid follows its items; complete items
  // make that the bill total, so the initiator starts with no difference.
  if (mode === "items" && data.totalCents === null && priced.every((i) => i.finalCents !== null))
    data.totalCents = reviewed.totalCents = priced.reduce((sum, i) => sum + i.finalCents!, 0);
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
      amountCents: null,
      confirmedAt: null,
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
  await tx
    .update(receiptDrafts)
    .set({ billId: bill!.id, revision: draft.revision + 1 })
    .where(eq(receiptDrafts.id, id));
  return { id: bill!.id, groupId: draft.groupId };
}
