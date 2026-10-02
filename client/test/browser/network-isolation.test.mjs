// An unrelated Docker bridge must not interrupt the app's JavaScript imports.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Network } from 'testcontainers';
import { expect } from '@playwright/test';
import { startEnvironment } from './environment.mjs';

test('Home loads while unrelated Docker bridges are created and removed', async () => {
  const env = await startEnvironment();
  let churn;
  try {
    const page = await env.pageFor('member-15-token');
    page.on('request', request => {
      if (churn || request.resourceType() !== 'script') return;
      churn = (async () => {
        for (let i = 0; i < 3; i++) {
          const network = await new Network().start();
          await network.stop();
        }
      })();
      // Awaited in finally even if loading fails first.
      churn.catch(() => {});
    });
    await page.goto(env.base);
    await expect(page.getByRole('region', { name: 'Your people, together.' })).toBeVisible();
    assert.ok(churn, 'The experiment must overlap bridge changes with script loading');
    await churn;
    assert.deepEqual([...env.networkChangeFailures], [], 'Network changes aborted browser resources');
    assert.deepEqual(env.errors, []);
  } finally {
    try { await churn; } finally { await env.dispose(); }
  }
});
