import { lockGroupForMember, requireMember } from '../../groups/group-access.js';
import { and, eq } from "drizzle-orm";
import { receiptDrafts } from "../../db/schema.js";
import { withoutLegacyShare } from "../receipt-input.js";
import { BillError } from "../../shared/bill-error.js";
import type { Transaction as Tx } from "../../db/types.js";

export async function ownDraft(
  tx: Tx,
  id: string,
  userId: string,
  lock = false,
) {
  if (lock) {
    const [scope] = await tx.select({ groupId: receiptDrafts.groupId }).from(receiptDrafts)
      .where(and(eq(receiptDrafts.id, id), eq(receiptDrafts.initiatorId, userId)));
    if (!scope) throw new BillError(404, "Draft not found.");
    await lockGroupForMember(tx, scope.groupId, userId);
  }
  const query = tx
    .select()
    .from(receiptDrafts)
    .where(
      and(eq(receiptDrafts.id, id), eq(receiptDrafts.initiatorId, userId)),
    );
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new BillError(404, "Draft not found.");
  await requireMember(tx, row.groupId, userId);
  return { ...row, data: withoutLegacyShare(row.data) };
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
