import { eq } from "drizzle-orm";
import { bills } from "../db/schema.js";
import type { Transaction as Tx } from '../db/types.js';
import { lockGroupForMember } from '../groups/group-access.js';
import { BillError } from "../shared/bill-error.js";
export async function lockedBill(tx: Tx, id: string, userId: string) {
  const [scope] = await tx.select({ groupId: bills.groupId }).from(bills).where(eq(bills.id, id));
  if (!scope) throw new BillError(404, "Bill not found.");
  await lockGroupForMember(tx, scope.groupId, userId);
  const [bill] = await tx
    .select()
    .from(bills)
    .where(eq(bills.id, id))
    .for("update");
  if (!bill) throw new BillError(404, "Bill not found.");
  return bill;
}
