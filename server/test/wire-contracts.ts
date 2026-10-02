// Compile-time checks exercise the actual server projections without exporting
// database types to the browser or changing Express's Date serialization.
import type { Bill } from '@share-tally/domain/contracts/bills';
import type { GroupDetail, ListedGroup, GroupDeletionEligibility } from '@share-tally/domain/contracts/groups';
import type { ReceiptDraft } from '@share-tally/domain/contracts/receipts';
import type { Repayment } from '@share-tally/domain/contracts/repayments';
import type { readBills } from '../src/bills/queries.js';
import type { listGroupsForUser, getGroupForMember, groupDeletionEligibility } from '../src/groups/groups.js';
import type { readDraft } from '../src/receipts/drafts/queries.js';
import type { readRepayments } from '../src/repayments/repayments.js';

type JsonWire<T> = T extends Date ? string : T extends object ? { [K in keyof T]: JsonWire<T[K]> } : T;
type Assert<T extends true> = T;
type Fits<Actual, Contract> = JsonWire<Awaited<Actual>> extends Contract ? true : false;

export type BillContract = Assert<Fits<ReturnType<typeof readBills>, Bill[]>>;
// Avatar URLs are enriched by the HTTP adapter after this group projection.
type GroupBeforeAvatars = Omit<ListedGroup, "memberPreview"> & { memberPreview: Pick<ListedGroup["memberPreview"][number], "id" | "displayName">[] };
export type GroupListContract = Assert<Fits<ReturnType<typeof listGroupsForUser>, GroupBeforeAvatars[]>>;
export type GroupDetailContract = Assert<Fits<ReturnType<typeof getGroupForMember>, GroupDetail>>;
export type DeletionContract = Assert<Fits<ReturnType<typeof groupDeletionEligibility>, GroupDeletionEligibility>>;
export type DraftContract = Assert<Fits<ReturnType<typeof readDraft>, ReceiptDraft>>;
export type RepaymentContract = Assert<Fits<ReturnType<typeof readRepayments>, Repayment[]>>;
