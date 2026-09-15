// Re-score saved responses without making model calls.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { evaluateChecks, matchesAll, type Fixture, type Result, type Engine } from '../../client/src/play/receipt-demo/evaluation.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures: Fixture[] = JSON.parse(await readFile(path.join(here, 'receipts/manifest.json'), 'utf8'));
const rows: { id: string; name: string; engine: Engine; status: string; matchedAll: boolean; durationMs?: number; checks: ReturnType<typeof evaluateChecks>; review: string | null }[] = [];
for (const fixture of fixtures) for (const engine of ['ai-sdk', 'receipt-scanner'] satisfies Engine[]) {
  let result: Result | undefined;
  try { result = JSON.parse(await readFile(path.join(here, 'results', `${engine}-${fixture.id}.json`), 'utf8')); } catch { /* Not run. */ }
  rows.push({ id: fixture.id, name: fixture.name, engine, status: result?.status ?? (result ? 'success' : 'pending'), matchedAll: matchesAll(fixture, result), durationMs: result?.durationMs, checks: evaluateChecks(fixture, result), review: fixture.reviewNotes?.[engine] ?? null });
}
const summary = ['ai-sdk', 'receipt-scanner'].map(engine => {
  const runs = rows.filter(r => r.engine === engine && r.status !== 'pending');
  return { engine, attempted: runs.length, successfulResponses: runs.filter(r => r.status === 'success').length, matchedAll: runs.filter(r => r.matchedAll).length, failedFields: runs.flatMap(r => r.checks.filter(c => c.status === 'fail' || c.status === 'error').map(c => ({ receipt: r.id, field: c.label, expected: c.expected, actual: c.actual, status: c.status }))) };
});
await writeFile(path.join(here, 'results/evaluation.json'), JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
