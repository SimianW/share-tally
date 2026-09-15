// Throwaway comparison server. Run with pnpm demo:receipts from server/.
import express from 'express';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { generateText, Output } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { ReceiptScanner, createOpenAICompatibleProvider } from 'receipt-ai-scanner';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '../../client');
const clientRequire = createRequire(path.join(clientRoot, 'package.json'));
const { createServer: createViteServer } = await import(pathToFileURL(clientRequire.resolve('vite')).href);
const fixtures = JSON.parse(await readFile(path.join(here, 'receipts/manifest.json'), 'utf8'));
const resultsDirectory = path.join(here, 'results');
await mkdir(path.join(resultsDirectory, 'history'), { recursive: true });
async function saveResult(engine: string, id: string, result: unknown) {
  const json = JSON.stringify(result, null, 2);
  await writeFile(path.join(resultsDirectory, 'history', `${engine}-${id}-${randomUUID()}.json`), json);
  await writeFile(path.join(resultsDirectory, `${engine}-${id}.json`), json);
}
const app = express();
const http = createServer(app);
app.use(express.json({ limit: '12mb' }));
app.use('/demo-receipts', express.static(path.join(here, 'receipts')));
const model = process.env.RECEIPT_DEMO_MODEL || 'gemini-2.5-flash';
function key() {
  config({ path: path.join(here, '../.env'), quiet: true });
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
}
const receiptSchema = z.object({
  merchant: z.string().nullable(), currency: z.string().nullable(),
  items: z.array(z.object({ description: z.string(), quantity: z.number().nullable(), unitPrice: z.number().nullable(), totalPrice: z.number() })),
  subtotal: z.number().nullable(), discountTotal: z.number().nullable(),
  taxes: z.array(z.object({ label: z.string(), amount: z.number() })),
  roundingAdjustment: z.number().nullable(), total: z.number().nullable(), warnings: z.array(z.string()),
});
const instructions = 'Read this receipt image. Preserve printed item descriptions. Return purchased goods only in items; exclude payment, change, subtotal, discount and rounding rows. Use the printed gross line amount before any separately printed discount as totalPrice. Report separate discounts as a positive discountTotal and rounding as a signed roundingAdjustment. Include every item. Unknown values must be null, not invented. The total is the final rounded amount due, not cash tendered. Do not infer CAD; read the actual currency. Report ambiguity in warnings.';
app.get('/receipt-demo-api/config', async (_req, res) => {
  const saved = [];
  for (const fixture of fixtures) for (const engine of ['ai-sdk', 'receipt-scanner']) {
    try { saved.push(JSON.parse(await readFile(path.join(resultsDirectory, `${engine}-${fixture.id}.json`), 'utf8'))); } catch { /* Not run yet. */ }
  }
  res.json({ configured: Boolean(key()), model, fixtures, results: saved });
});
let busy = false;
app.post('/receipt-demo-api/extract', async (req, res) => {
  const origin = req.get('origin');
  if (origin && new URL(origin).host !== req.get('host')) { res.status(403).json({ error: 'Use the demo page on this server.' }); return; }
  const apiKey = key();
  if (!apiKey) { res.status(503).json({ error: 'Add GOOGLE_GENERATIVE_AI_API_KEY to server/.env, then retry. No extraction has run.' }); return; }
  const { engine, receiptId, upload } = req.body;
  if (!['ai-sdk', 'receipt-scanner'].includes(engine)) { res.status(400).json({ error: 'Unknown engine.' }); return; }
  const fixture = fixtures.find((f: { id: string }) => f.id === receiptId);
  if (!fixture && !(upload && typeof upload.base64 === 'string' && ['image/jpeg', 'image/png', 'image/webp'].includes(upload.mediaType))) {
    res.status(400).json({ error: 'Choose a sample or upload a JPEG, PNG or WebP image.' }); return;
  }
  if (busy) { res.status(429).json({ error: 'An extraction is already running. Try again when it finishes.' }); return; }
  busy = true;
  const started = Date.now();
  try {
    const bytes = fixture ? await readFile(path.join(here, 'receipts', `${fixture.id}.jpg`)) : Buffer.from(upload.base64, 'base64');
    const mediaType = fixture ? 'image/jpeg' : upload.mediaType;
    let data; let raw; let usage;
    if (engine === 'ai-sdk') {
      const google = createGoogleGenerativeAI({ apiKey });
      const result = await generateText({
        model: google(model), output: Output.object({ schema: receiptSchema }),
        messages: [{ role: 'user', content: [{ type: 'text', text: instructions }, { type: 'image', image: bytes, mediaType }] }],
        maxOutputTokens: 8192, maxRetries: 0, abortSignal: AbortSignal.timeout(90000),
      });
      data = result.output; raw = result.text; usage = result.usage;
    } else {
      const scanner = new ReceiptScanner({
        provider: createOpenAICompatibleProvider({ apiKey, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', defaultModel: model, name: 'gemini' }),
        strictValidation: true, maxTokens: 8192, timeoutMs: 90000, systemPromptAppend: instructions,
      });
      const result = await scanner.scan({ base64: bytes.toString('base64'), mediaType });
      data = result.data; raw = result.rawResponse; usage = result.usage;
    }
    const result = { engine, receiptId: fixture?.id ?? 'upload', model, status: 'success', ranAt: new Date().toISOString(), durationMs: Date.now() - started, imageSha256: fixture?.sha256, protocol: 'receipt-demo-v1', data, raw, usage };
    if (fixture) await saveResult(engine, fixture.id, result);
    res.json(result);
  } catch (error) {
    // SDK error objects can include request details. Return a short redacted message only.
    const message = (error instanceof Error ? error.message : 'Extraction failed').replaceAll(apiKey, '[redacted]').slice(0, 700);
    const failure = { error: message, status: 'error', engine, receiptId: fixture?.id ?? 'upload', model, ranAt: new Date().toISOString(), imageSha256: fixture?.sha256, protocol: 'receipt-demo-v1', durationMs: Date.now() - started };
    if (fixture) await saveResult(engine, fixture.id, failure);
    res.status(502).json(failure);
  } finally { busy = false; }
});
const vite = await createViteServer({
  root: clientRoot, configFile: path.join(clientRoot, 'vite.config.ts'),
  server: { middlewareMode: true, allowedHosts: ['dev-2a1m'], hmr: { server: http }, proxy: {} }, appType: 'spa',
});
app.use(vite.middlewares);
http.listen(5180, '0.0.0.0', () => console.log('Receipt demos: http://dev-2a1m:5180/#/prototype/receipts/ai-sdk'));
