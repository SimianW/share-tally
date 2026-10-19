import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const gate = fileURLToPath(new URL('./gate.sh', import.meta.url));
const heavyLock = fileURLToPath(new URL('./heavy-lock.mjs', import.meta.url));

const hasFlock = !spawnSync('flock', ['-V']).error;

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'share-tally-gate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// Runs the gate with stub steps and a private lock, never the real checks.
async function runGate(t, { check, browserCheck, path }) {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, 'check.sh'), check);
  await writeFile(join(directory, 'browser-check.sh'), browserCheck);
  const env = { ...process.env, SHARE_TALLY_HEAVY_LOCK: join(directory, 'lock'),
    SHARE_TALLY_GATE_CHECK: `sh ${join(directory, 'check.sh')}`,
    SHARE_TALLY_GATE_BROWSER_CHECK: `sh ${join(directory, 'browser-check.sh')}`, ...(path && { PATH: path }) };
  delete env.SHARE_TALLY_HEAVY_LOCK_HELD;
  const { status, stdout, stderr } = spawnSync('sh', [gate], { env, encoding: 'utf8', timeout: 20_000 });
  return { status, output: stdout + stderr };
}

test('a failed step fails the gate, later steps still run and the summary names the failures', async t => {
  const { status, output } = await runGate(t, {
    check: 'printf "check output without a final newline"; exit 3\n',
    browserCheck: 'echo "Failed: receipts/scan-fallback, groups/group-refresh" >&2\n'
      + 'printf "Browser release gate failed: test:environment browser-scenarios." >&2; exit 1\n',
  });
  assert.equal(status, 1, output);
  assert.match(output, /check output without a final newline\n=== deploy\/check\.sh exited with 3/);
  const summary = output.slice(output.indexOf('Gate failed.'));
  assert.match(summary, /deploy\/check\.sh \(exit 3\)/);
  assert.match(summary, /deploy\/browser-check\.sh \(exit 1\)/);
  assert.match(summary, /Reported failures:\n {2}Failed: receipts\/scan-fallback, groups\/group-refresh\n {2}Browser release gate failed: test:environment browser-scenarios\.\n/);
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

test('without flock the gate runs once without the lock', async t => {
  // A PATH with the gate's tools but no flock(1), as on stock macOS.
  const bin = join(await temporaryDirectory(t), 'bin');
  await mkdir(bin);
  for (const tool of ['sh', 'dirname', 'mktemp', 'tee', 'cat', 'tail', 'grep', 'sed', 'rm']) {
    const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    await symlink(found, join(bin, tool));
  }
  await symlink(process.execPath, join(bin, 'node'));
  const { status, output } = await runGate(t, { check: 'exit 0\n', browserCheck: 'exit 0\n', path: bin });
  assert.equal(status, 0, output);
  assert.equal(output.match(/running without the heavy-check lock/g)?.length, 1, output);
  assert.match(output, /Gate passed\./);
});

test('the lock stays held until a descendant outlives the killed wrapper', { skip: !hasFlock && 'needs flock(1)' }, async t => {
  const lock = join(await temporaryDirectory(t), 'lock');
  const env = { ...process.env, SHARE_TALLY_HEAVY_LOCK: lock };
  delete env.SHARE_TALLY_HEAVY_LOCK_HELD;
  const isFree = () => spawnSync('flock', ['-n', lock, 'true']).status === 0;
  // sh dies on SIGTERM without signalling its background sleep, as it leaves a foreground docker run.
  const wrapper = spawn(process.execPath, [heavyLock, 'sh', '-c', 'sleep 3 & echo $!; wait'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const [orphan] = await once(wrapper.stdout, 'data');
  t.after(() => { try { process.kill(Number(orphan), 'SIGKILL'); } catch {} });
  const started = Date.now();
  wrapper.kill('SIGTERM');
  const [code] = await once(wrapper, 'exit');
  assert.equal(code, 143);
  assert.equal(isFree(), false, 'the lock was released while the orphaned sleep still ran');
  assert.equal(spawnSync('flock', ['-w', '10', lock, 'true']).status, 0);
  assert.ok(Date.now() - started > 2000, 'the lock was released before the orphaned sleep exited');
});

test('SIGINT sent to the wrapper alone stops the command', { skip: !hasFlock && 'needs flock(1)' }, async t => {
  const env = { ...process.env, SHARE_TALLY_HEAVY_LOCK: join(await temporaryDirectory(t), 'lock') };
  delete env.SHARE_TALLY_HEAVY_LOCK_HELD;
  const wrapper = spawn(process.execPath, [heavyLock, 'sh', '-c', 'echo started; exec sleep 10'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => wrapper.kill('SIGKILL'));
  await once(wrapper.stdout, 'data');
  const started = Date.now();
  wrapper.kill('SIGINT');
  const [code] = await once(wrapper, 'exit');
  assert.equal(code, 130);
  assert.ok(Date.now() - started < 5000, 'the command ran on after SIGINT');
});

test('a symlink at the lock path is refused and its target left untouched', async t => {
  const directory = await temporaryDirectory(t);
  const target = join(directory, 'victim');
  await writeFile(target, 'keep me\n');
  await symlink(target, join(directory, 'lock'));
  const env = { ...process.env, SHARE_TALLY_HEAVY_LOCK: join(directory, 'lock') };
  delete env.SHARE_TALLY_HEAVY_LOCK_HELD;
  const { status, stdout, stderr } = spawnSync(process.execPath, [heavyLock, 'sh', '-c', 'echo ran'], { env, encoding: 'utf8', timeout: 20_000 });
  assert.equal(status, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /^heavy-lock: .*symlink/);
  assert.doesNotMatch(stderr, /\n\s+at /, 'printed a stack trace');
  assert.equal(await readFile(target, 'utf8'), 'keep me\n');
});
