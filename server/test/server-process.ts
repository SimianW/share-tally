import { purgeExpiredPhotos } from '../src/receipt-drafts.js';
import { createAzureExtractor } from '../src/azure-receipt.js';
import { readFileSync } from 'node:fs';
import { BillError } from '../src/bill-error.js';
import { createApp } from '../src/app.js';
import { closeDatabase } from '../src/db/index.js';

// Only this test entry point knows these tokens. Production always uses Clerk.
const identities = new Map([
  ['Bearer alice-token', 'user_test_alice'],
  ['Bearer bob-token', 'user_test_bob'],
  ['Bearer carol-token', 'user_test_carol'],
]);
for (let i = 1; i <= 17; i++)
  identities.set(`Bearer member-${i}-token`, `user_test_member_${i}`);
let scans = 0;
let recordedScans = 0;
let useRecorded = false;
const fixtures = ['azure-225', 'azure-525'];
const recordedExtract = createAzureExtractor(
  { AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: 'https://azure.example.test', AZURE_DOCUMENT_INTELLIGENCE_KEY: 'test-only' },
  async (_url, init) => init?.method === 'POST'
    ? new Response(null, { status: 202, headers: { 'operation-location': 'https://azure.example.test/results/1' } })
    : Response.json({ status: 'succeeded', analyzeResult: JSON.parse(readFileSync(new URL(`./fixtures/azure-receipt/${fixtures[(recordedScans++ % fixtures.length)]}.json`, import.meta.url), 'utf8')) }),
  async () => {},
);
let holdExtraction = false;
let releaseExtraction: (() => void) | undefined;
process.on('message', message => {
  if (message === 'recorded-evidence-off') { useRecorded = false; process.send?.('recorded-evidence-stopped'); }
  if (message === 'recorded-evidence') { recordedScans = 0; useRecorded = true; process.send?.('recorded-evidence-ready'); }
  if (message === 'hold-extraction') { holdExtraction = true; process.send?.('holding-extraction'); }
  if (message === 'release-extraction') { holdExtraction = false; releaseExtraction?.(); releaseExtraction = undefined; }
});
const app = createApp({
  receiptExtractor: async (image) => {
    if (useRecorded) return recordedExtract(image);
    if (holdExtraction) await new Promise<void>(resolve => { releaseExtraction = resolve; process.send?.('extraction-held'); });
    if (++scans === 1) throw new BillError(502, 'Test extraction unavailable. Your draft is safe.');
    return { merchant: 'Test shop', currency: 'CAD', total: 3, pricesIncludeTax: false, items: [{ description: 'APPLE', plainEnglish: null, quantity: '1', amount: 3, discount: null, tax: null, taxable: null }], discountTotal: null, taxTotal: null, otherCharges: null, warnings: [] };
  },
  receiptNames: async (items, _config, _request, context) => {
    if (items.some(i => i.originalText === 'FAIL-NAMES')) throw new Error('Test name failure');
    return items.map(i => ({ id: i.id, name: 'Apples', ...(context ? { taxable: true } : {}) }));
  },
  avatarUrl: async id => id === 'user_test_alice'
    ? { fallbackImageUrl: null, imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect width="40" height="40" fill="green"/%3E%3C/svg%3E' }
    : null,
  displayName: async id => ({ user_test_alice: 'Alice', user_test_bob: 'Bob', user_test_carol: 'Carol' })[id] ?? 'Member',
  middleware: (_req, _res, next) => next(),
  userId: (req) => identities.get(req.get('authorization') ?? '') ?? null,
});
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') process.send?.(address.port);
});
process.once('SIGTERM', () => {
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  server.closeAllConnections();
});

process.on('message', async message => { if (message === 'purge-photos') { await purgeExpiredPhotos(); process.send?.('photos-purged'); } });
