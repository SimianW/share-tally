// Runs browser scenarios one at a time, each in its own environment.
//   node test/browser/run.mjs groups                  every groups scenario
//   node test/browser/run.mjs draft-save-and-recovery one scenario, by name
//   node test/browser/run.mjs --list                  every scenario name
// A failing scenario does not stop the ones after it; the run fails at the end.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { screenshots, startEnvironment } from './environment.mjs';
import { suites } from './suites.mjs';

const args = process.argv.slice(2);
const all = Object.entries(suites).flatMap(([suite, scenarios]) => scenarios.map(scenario => ({ suite, ...scenario })));
if (args.includes('--list') || args.length === 0) {
  for (const [suite, scenarios] of Object.entries(suites)) console.log(`${suite}:\n${scenarios.map(({ name }) => `  ${name}`).join('\n')}`);
  process.exit(args.length === 0 ? 2 : 0);
}
const unknown = args.filter(arg => !suites[arg] && !all.some(({ name }) => name === arg));
if (unknown.length) {
  console.error(`Unknown suite or scenario: ${unknown.join(', ')}. Use --list to see every scenario.`);
  process.exit(2);
}
// Scenario names select just those scenarios, even after a suite name
// (`pnpm test:receipts scan-fallback`); suite names alone select whole suites.
const named = all.filter(({ name }) => args.includes(name));
const selected = named.length ? named : all.filter(({ suite }) => args.includes(suite));

let active, starting, interrupted = false;
// After a signal the handler owns shutdown; the scenario loop waits for it to exit the process.
const awaitShutdown = () => new Promise(() => {});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  interrupted = true;
  console.error(`\n${signal}: disposing the running scenario's environment.`);
  // An environment still starting is disposed once it is up; a failed start disposes itself.
  const env = active ?? await starting?.catch(() => undefined);
  await env?.dispose().catch(error => console.error(error));
  process.exit(130);
});

// An error thrown outside the scenario's own await chain (a route handler, say)
// fails the running scenario instead of ending the process with resources open.
let crash;
for (const event of ['unhandledRejection', 'uncaughtException']) process.on(event, error => {
  if (crash) crash(error);
  else { console.error(error); process.exitCode = 1; }
});

const failed = [];
for (const scenario of selected) {
  const label = `${scenario.suite}/${scenario.name}`;
  console.log(`\n▶ ${label}`);
  const started = Date.now();
  const seconds = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
  active = starting = undefined;
  try {
    const crashed = new Promise((_, reject) => { crash = reject; });
    starting = startEnvironment(scenario.environment);
    active = await starting;
    if (interrupted) await awaitShutdown();
    await Promise.race([scenario.run(active), crashed]);
    assert.deepEqual(active.errors, [], 'Pages raised uncaught errors');
    console.log(`✓ ${label} (${seconds()})`);
  } catch (error) {
    if (interrupted) await awaitShutdown();
    failed.push(label);
    console.error(`✗ ${label} failed after ${seconds()}:`);
    console.error(error);
    if (active) await reportFailure(active, scenario.name);
  } finally {
    crash = undefined;
    try { await active?.dispose(); } catch (error) {
      if (!failed.includes(label)) failed.push(label);
      console.error(`✗ ${label} left resources behind:`, error);
    }
  }
}
console.log(`\n${selected.length - failed.length} of ${selected.length} browser scenarios passed.`);
if (failed.length) {
  console.error(`Failed: ${failed.join(', ')}`);
  process.exit(1);
}

// Keeps a screenshot and the visible text of every open page under test-results/failures/<scenario>/.
async function reportFailure(env, name) {
  if (env.networkChangeFailures.size) {
    console.error('Browser resource loading was interrupted by ERR_NETWORK_CHANGED. Host network changes, including concurrent Docker container startup/shutdown, can leave the app blank before UI assertions run. Run browser scenarios separately from container-changing jobs; the assertion still fails.');
    console.error('Affected resource samples:', [...env.networkChangeFailures.entries()].slice(0, 8));
  }
  const directory = `${screenshots}/failures/${name}`;
  await mkdir(directory, { recursive: true });
  let index = 0;
  for (const context of env.browser.contexts()) for (const page of context.pages()) {
    index++;
    try {
      await page.screenshot({ path: `${directory}/page-${index}.png`, fullPage: true, timeout: 5_000 });
      console.error(`Failed browser page ${index}:`, page.url(), (await page.locator('body').innerText({ timeout: 5_000 })).slice(0, 3000));
    } catch (error) {
      console.error(`Could not capture page ${index} (${page.url()}):`, error.message);
    }
  }
  if (index) console.error(`Failure screenshots: ${directory}`);
  console.error('Browser errors:', env.errors);
}
