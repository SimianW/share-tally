import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const gate = fileURLToPath(new URL('./gate.sh', import.meta.url));
const heavyLock = fileURLToPath(new URL('./heavy-lock.mjs', import.meta.url));

// Runs the gate with stub steps and a private lock, never the real checks.
async function runGate(t, { check, browserCheck }) {
  const directory = await mkdtemp(join(tmpdir(), 'share-tally-gate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'check.sh'), check);
  await writeFile(join(directory, 'browser-check.sh'), browserCheck);
  const env = { ...process.env, SHARE_TALLY_HEAVY_LOCK: join(directory, 'lock'),
    SHARE_TALLY_GATE_CHECK: `sh ${join(directory, 'check.sh')}`,
    SHARE_TALLY_GATE_BROWSER_CHECK: `sh ${join(directory, 'browser-check.sh')}` };
  delete env.SHARE_TALLY_HEAVY_LOCK_HELD;
  const { status, stdout, stderr } = spawnSync('sh', [gate], { env, encoding: 'utf8', timeout: 20_000 });
  return { status, output: stdout + stderr };
}

test('a failed step fails the gate, later steps still run and the summary names the failures', async t => {
  const { status, output } = await runGate(t, {
    check: 'echo check output; exit 3\n',
    browserCheck: 'echo "Failed: receipts/scan-fallback, groups/group-refresh" >&2; exit 1\n',
  });
  assert.equal(status, 1, output);
  const summary = output.slice(output.indexOf('Gate failed.'));
  assert.match(summary, /deploy\/check\.sh \(exit 3\)/);
  assert.match(summary, /deploy\/browser-check\.sh \(exit 1\)/);
  assert.match(summary, /Failed scenarios:\n {2}receipts\/scan-fallback, groups\/group-refresh/);
});

test('a failure in the last step alone still fails the gate', async t => {
  const { status, output } = await runGate(t, { check: 'exit 0\n', browserCheck: 'exit 1\n' });
  assert.equal(status, 1, output);
  assert.match(output, /Gate failed\. Failed steps:\n {2}deploy\/browser-check\.sh \(exit 1\)/);
  assert.doesNotMatch(output.slice(output.indexOf('Gate failed.')), /deploy\/check\.sh \(/);
});

test('a passing gate runs nested heavy checks under its lock without waiting', async t => {
  const nested = `node ${heavyLock} sh -c 'echo nested ran'\n`;
  const { status, output } = await runGate(t, { check: nested, browserCheck: nested });
  assert.equal(status, 0, output);
  assert.equal(output.match(/nested ran/g)?.length, 2, output);
  assert.doesNotMatch(output, /waiting for/);
  assert.match(output, /Gate passed\./);
});
