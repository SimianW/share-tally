import { roundedCost, sumFractions } from '@share-tally/domain/fractions';
import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { billItems, billShares, bills, itemClaims, receiptDrafts, receiptPhotos, } from "../../db/schema.js";
import type { Transaction as Tx } from '../../db/types.js';
import type { boundingRegion, receiptEvidenceFields } from "../../receipts/receipt-input.js";
import { BillError } from "../../shared/bill-error.js";

type Region = z.infer<typeof boundingRegion>;
type Pages = NonNullable<z.infer<typeof receiptEvidenceFields>['pages']>;
type BillItem = typeof billItems.$inferSelect;
type ItemClaim = typeof itemClaims.$inferSelect;

// The single-bill read used by item commands, through the same batch reader.
export async function itemDetails(tx: Tx, billId: string) {
  return (await readItemDetailsInSnapshot(tx, [billId])).get(billId)!;
}

// Reads the items, claims and photo source of bills that the caller has
// already authorized, in the caller's transaction and snapshot. It runs three
// queries however many bills there are and performs no access check of its
// own, so callers pass only ids returned by their authorized read.
export async function readItemDetailsInSnapshot(tx: Tx, billIds: string[]) {
  const { items, claims } = await itemsWithClaims(tx, billIds);
  const sources = billIds.length ? await tx
    .select({
      billId: receiptDrafts.billId,
      draftId: receiptDrafts.id,
      expiresAt: receiptPhotos.expiresAt,
      // Bill items keep their draft item ids. Read only where each item sits on
      // the photo and the page geometry, never the rest of the scan evidence.
      regions: sql<{ id: string; region: Region | null }[] | null>`(
        select jsonb_agg(jsonb_build_object('id', entry.item->'id', 'region', coalesce(
          nullif(entry.item->'evidence'->'regions'->0, 'null'::jsonb),
          entry.item->'evidence'->'descriptionRegions'->0)) order by entry.position)
        from jsonb_array_elements(${receiptDrafts.data}->'items') with ordinality as entry(item, position))`,
      pages: sql<Pages | null>`${receiptDrafts.data}->'receipt'->'evidence'->'pages'`,
    })
    .from(receiptDrafts)
    .innerJoin(receiptPhotos, eq(receiptPhotos.draftId, receiptDrafts.id))
    .where(inArray(receiptDrafts.billId, billIds)) : [];
  const claimsByItem = groupBy(claims, claim => claim.itemId);
  const itemsByBill = groupBy(items, item => item.billId);
  const sourceByBill = new Map<string, (typeof sources)[number]>();
  for (const source of sources) if (!sourceByBill.has(source.billId!)) sourceByBill.set(source.billId!, source);
  const now = new Date();
  return new Map(billIds.map(billId => {
    const source = sourceByBill.get(billId);
    const expired = !source || source.expiresAt <= now;
    // Both the regions and the page geometry expire with the photo.
    const regions = new Map(expired ? [] : (source.regions ?? []).map(({ id, region }) => [id, region] as const));
    const pages = expired ? undefined : source.pages;
    return [billId, {
      items: (itemsByBill.get(billId) ?? []).map((item) => ({
        ...item,
        allocatedTaxCents: item.taxCents,
        allocatedExtraCents: item.extraCents,
        // Legacy items predate receipt summaries: their stored tax and extra
        // are known, but the receipt discount share and manual provenance are not.
        claims: claimsByItem.get(item.id) ?? [],
        receiptRegion: regions.get(item.id) ?? null,
      })),
      photo: source ? {
        draftId: source.draftId, expiresAt: source.expiresAt, expired,
        ...(pages ? { pages } : {}),
      } : null,
    }] as const;
  }));
}
export async function recalculateItemBill(
  tx: Tx,
  bill: typeof bills.$inferSelect,
) {
  const loaded = await itemsWithClaims(tx, [bill.id]);
  const items = loaded.items.map(item => ({ ...item, claims: loaded.claims.filter(claim => claim.itemId === item.id) }));
  const shares = await tx
    .select()
    .from(billShares)
    .where(eq(billShares.billId, bill.id));
  for (const share of shares) {
    const own = items.flatMap((item) =>
      item.claims
        .filter((c) => c.userId === share.userId && c.confirmedAt)
        .map((c) => ({ ...c, finalCents: item.finalCents })),
    );
    const amount = roundedCost(own);
    if (amount > 1_000_000)
      throw new BillError(
        400,
        "A personal share cannot exceed CAD 10,000. Correct the item costs.",
      );
    // Missing remains distinct from an explicit zero, including after adding a participant.
    const amountCents =
      share.amountCents === null && !own.length && !share.confirmedAt
        ? null
        : amount;
    await tx
      .update(billShares)
      .set({ amountCents })
      .where(
        and(
          eq(billShares.billId, bill.id),
          eq(billShares.userId, share.userId),
        ),
      );
    share.amountCents = amountCents;
  }
  if (
    !items.length ||
    shares.some((s) => !s.confirmedAt || s.amountCents === null)
  )
    return;
  if (
    items.some((item) => {
      const sum = sumFractions(item.claims.filter((c) => c.confirmedAt));
      return sum.n !== sum.d;
    })
  )
    return;
  const sum = shares.reduce((n, s) => n + s.amountCents!, 0);
  const adjustmentCents = bill.totalCents - sum;
  const initiator = shares.find((s) => s.userId === bill.initiatorId)!;
  if (initiator.amountCents! + adjustmentCents < 0) return;
  await tx
    .update(bills)
    .set({ completedAt: new Date(), adjustmentCents })
    .where(eq(bills.id, bill.id));
}

// Items in receipt order within each bill, and their claims. Claims select by
// item id, as a single array parameter because a bill can have 200 items.
async function itemsWithClaims(tx: Tx, billIds: string[]): Promise<{ items: BillItem[]; claims: ItemClaim[] }> {
  if (!billIds.length) return { items: [], claims: [] };
  const items = await tx
    .select()
    .from(billItems)
    .where(inArray(billItems.billId, billIds))
    .orderBy(billItems.position, billItems.id);
  const claims = items.length
    ? await tx
        .select()
        .from(itemClaims)
        .where(sql`${itemClaims.itemId} = any(${sql.param(items.map((i) => i.id))}::uuid[])`)
    : [];
  return { items, claims };
}

function groupBy<T>(values: T[], key: (value: T) => string) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const group = groups.get(key(value));
    if (group) group.push(value);
    else groups.set(key(value), [value]);
  }
  return groups;
}
