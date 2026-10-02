// Every browser scenario, by the aggregate command that runs it. Each scenario
// creates its own users, group and records, so any one can run alone.
import { scenarios as avatar } from './avatar.mjs';
import { scenarios as amountPortion } from './groups/amount-portion.mjs';
import { scenarios as appearance } from './groups/appearance.mjs';
import { scenarios as bills } from './groups/bills.mjs';
import { scenarios as groupPage } from './groups/group-page.mjs';
import { scenarios as ledger } from './groups/ledger.mjs';
import { scenarios as membership } from './groups/membership.mjs';
import { scenarios as navigation } from './groups/navigation.mjs';
import { scenarios as claiming } from './receipts/claiming.mjs';
import { scenarios as corrections } from './receipts/corrections.mjs';
import { scenarios as drafts } from './receipts/drafts.mjs';
import { scenarios as newBill } from './receipts/new-bill.mjs';
import { scenarios as processing } from './receipts/processing.mjs';

const ordered = (scenarios, names) => names.map(name => {
  const scenario = scenarios.find(candidate => candidate.name === name);
  if (!scenario) throw new Error(`No browser scenario named ${name}`);
  return scenario;
});

const groupScenarios = [...membership, ...appearance, ...bills, ...navigation, ...ledger, ...groupPage, ...amountPortion];
const receiptScenarios = [...newBill, ...drafts, ...claiming, ...corrections, ...processing];

export const suites = {
  groups: ordered(groupScenarios, [
    'group-refresh', 'group-invitations', 'appearance', 'bill-sharing', 'navigation-and-account-isolation',
    'bill-corrections', 'repayments', 'group-capacity', 'bill-live-updates', 'attention',
    'group-page-ledger', 'amount-portion', 'group-deletion',
  ]),
  receipts: ordered(receiptScenarios, [
    'scan-retry', 'new-bill-during-refresh', 'receipt-crop', 'draft-save-and-recovery', 'item-claims', 'claim-controls',
    'correction-races', 'claim-auto-advance', 'claiming-conflicts', 'claim-review', 'processing-recovery',
    'scanned-draft-editing', 'compact-review', 'claim-receipt-photo', 'unassigned-tax',
    'legacy-price-correction', 'price-correction', 'scan-fallback', 'low-confidence-hints', 'manual-split-fallback',
  ]),
  avatar,
};
for (const [suite, scenarios] of Object.entries({ groups: groupScenarios, receipts: receiptScenarios }))
  if (scenarios.length !== suites[suite].length) throw new Error(`Every ${suite} scenario must be listed in its suite`);
