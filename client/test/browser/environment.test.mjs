// A start-up that fails part-way disposes everything it had already started.
// Needs Docker: node --test test/browser/environment.test.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { startEnvironment } from './environment.mjs';

const run = promisify(execFile);
const containerExists = id => run('docker', ['inspect', id]).then(() => true, () => false);
function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

// Starts an environment that fails right after `stage`, keeping what each stage reported.
async function failAfter(stage) {
  const started = {};
  await assert.rejects(startEnvironment({
    checkpoint: async (reached, details) => {
      Object.assign(started, details);
      if (reached === stage) throw new Error(`Injected failure after ${stage}`);
    },
  }), new RegExp(`Injected failure after ${stage}`));
  return started;
}

test('a failure after the database starts removes its container', async () => {
  const { containerId } = await failAfter('database');
  assert.ok(containerId);
  assert.equal(await containerExists(containerId), false, 'PostgreSQL container was left behind');
});

test('a failure after the API starts stops it and removes the database', async () => {
  const { containerId, pid } = await failAfter('api');
  assert.ok(containerId && pid);
  assert.equal(processExists(pid), false, 'API process was left running');
  assert.equal(await containerExists(containerId), false, 'PostgreSQL container was left behind');
});
