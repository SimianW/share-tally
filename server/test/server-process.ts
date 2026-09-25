import { purgeExpiredPhotos } from '../src/receipt-drafts.js';
import { createAzureExtractor } from '../src/azure-receipt.js';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { BillError } from '../src/bill-error.js';
import { createApp } from '../src/app.js';
import { startServer } from '../src/start-server.js';
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
let emptyReceipt = false;
let numericLegend = false;
let allocationReceipt = false;
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
let holdModel = false;
let releaseModel: (() => void) | undefined;
let modelMode: 'ok' | 'error' | 'invalid' | 'partial' = 'ok';
process.on('message', message => {
  if (message === 'empty-receipt') { emptyReceipt = true; process.send?.('empty-receipt-ready'); }
  if (message === 'normal-receipt') { emptyReceipt = false; process.send?.('normal-receipt-ready'); }
  if (message === 'allocation-receipt') { allocationReceipt = true; process.send?.('allocation-receipt-ready'); }
  if (message === 'normal-allocation') { allocationReceipt = false; process.send?.('normal-allocation-ready'); }
  if (message === 'numeric-legend') { numericLegend = true; process.send?.('numeric-legend-ready'); }
  if (message === 'normal-legend') { numericLegend = false; process.send?.('normal-legend-ready'); }
  if (message === 'hold-model') { holdModel = true; process.send?.('holding-model'); }
  if (message === 'release-model') { holdModel = false; releaseModel?.(); releaseModel = undefined; }
  if (typeof message === 'string' && message.startsWith('model-mode-')) {
    modelMode = message.slice('model-mode-'.length) as typeof modelMode;
    process.send?.(`model-mode-${modelMode}-ready`);
  }
  if (message === 'recorded-evidence-off') { useRecorded = false; process.send?.('recorded-evidence-stopped'); }
  if (message === 'recorded-evidence') { recordedScans = 0; useRecorded = true; process.send?.('recorded-evidence-ready'); }
  if (message === 'hold-extraction') { holdExtraction = true; process.send?.('holding-extraction'); }
  if (message === 'release-extraction') { holdExtraction = false; releaseExtraction?.(); releaseExtraction = undefined; }
});
const app = createApp({
  receiptExtractor: async (image) => {
    if (useRecorded) return recordedExtract(image);
    if (holdExtraction) await new Promise<void>(resolve => { releaseExtraction = resolve; process.send?.('extraction-held'); });
    if (++scans === 1 && !emptyReceipt && !numericLegend && !allocationReceipt) throw new BillError(502, 'Test extraction unavailable. Your draft is safe.');
    if (allocationReceipt) return { merchant: 'Test shop', currency: 'CAD', total: 3.15, pricesIncludeTax: false, items: ['APPLE', 'SOAP', 'CANDLE'].map(description => ({ description, plainEnglish: null, quantity: '1', amount: 1, discount: null, tax: null, taxable: null })), discountTotal: null, taxTotal: 0.15, otherCharges: null, warnings: [] };
    return { merchant: 'Test shop', currency: 'CAD', total: emptyReceipt ? 0 : 3, pricesIncludeTax: false, items: emptyReceipt ? [] : [{ description: 'APPLE', plainEnglish: null, quantity: '1', amount: 3, discount: null, tax: null, taxable: null }], discountTotal: null, taxTotal: null, otherCharges: null, warnings: [], ...(numericLegend ? { text: 'A = 0%\nB: 13' } : {}) };
  },
  receiptNames: async (evidence) => {
    if (numericLegend && (!evidence.taxCodeLines.includes('A = 0%') || !evidence.taxCodeLines.includes('B: 13')))
      throw new Error('Numeric tax legend was not passed to the model');
    const wasHeld = holdModel;
    if (holdModel) await new Promise<void>(resolve => { releaseModel = resolve; process.send?.('model-held'); });
    if (wasHeld) process.send?.('model-released');
    if (modelMode === 'error' || evidence.items.some(i => i.description === 'FAIL-NAMES')) throw new Error('Test name failure');
    if (modelMode === 'invalid') return { items: [{ id: crypto.randomUUID(), name: 'Wrong item', taxable: false }] };
    return { items: (modelMode === 'partial' ? evidence.items.slice(0, 1) : evidence.items).map((i, index) => ({ id: i.id, name: `Friendly item ${index + 1}`, taxable: index !== 0 })) };
  },
  avatarUrl: async id => id === 'user_test_alice'
    ? { fallbackImageUrl: null, imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect width="40" height="40" fill="green"/%3E%3C/svg%3E' }
    : null,
  displayName: async id => ({ user_test_alice: 'Alice', user_test_bob: 'Bob', user_test_carol: 'Carol' })[id] ?? 'Member',
  middleware: (_req, _res, next) => next(),
  userId: (req) => identities.get(req.get('authorization') ?? '') ?? null,
});
// Use the production startup sequence so recovery on restart is exercised here.
const server = await startServer(app, 0, '127.0.0.1');
if (!server.listening) await once(server, 'listening');
const address = server.address();
if (address && typeof address !== 'string') process.send?.(address.port);
process.once('SIGTERM', () => {
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  server.closeAllConnections();
});

process.on('message', async message => { if (message === 'purge-photos') { await purgeExpiredPhotos(); process.send?.('photos-purged'); } });
