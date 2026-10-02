// Avatar component checks in a bare page served by the environment's Vite; no API is needed.
import assert from 'node:assert/strict';
import { relative } from 'node:path';
import { expect } from '@playwright/test';

export const scenarios = [
  { name: 'avatar', environment: { backend: false }, run: avatar },
];

async function avatar({ vite, base, pageFor }) {
  const page = await pageFor(null, { width: 1280, height: 720 });
  // Optimized dependencies live under the environment's own cache directory.
  const deps = `/${relative(vite.config.root, vite.config.cacheDir)}/deps`;
  await page.route(base, async route => route.fulfill({
    contentType: 'text/html',
    body: await vite.transformIndexHtml('/', '<html><body></body></html>'),
  }));
  await page.goto(base);
  await page.evaluate(async deps => {
    const { default: React } = await import(`${deps}/react.js`);
    const { default: { createRoot } } = await import(`${deps}/react-dom_client.js`);
    const { Avatar } = await import('/src/shared/ui/Avatar.tsx');
    await import('/src/app/app.css');
    await import('/src/features/bills/bills.css');
    const root = document.createElement('div'); document.body.replaceChildren(root);
    createRoot(root).render(React.createElement('div', { className: 'bill-person' },
      React.createElement(Avatar, { name: 'Simon', imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/%3E' }),
      React.createElement(Avatar, { name: 'Bob' }),
      React.createElement(Avatar, { name: 'Carol', imageUrl: '/broken-avatar.png' }),
      React.createElement(Avatar, { name: 'David', imageUrl: '/broken-google.png', fallbackImageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/%3E' })));
  }, deps);
  await page.locator('.avatar').first().waitFor();
  await expect(page.locator('.avatar').nth(2)).toHaveText('C');
  await expect(page.locator('.avatar').nth(3).locator('img')).toHaveAttribute('src', /^data:image/);
  assert.equal(await page.locator('.avatar').first().locator('img').count(), 1, 'Provided profile image must render');
  assert.equal(await page.locator('.avatar').nth(2).innerText(), 'C', 'Broken image falls back to initial');
  const style = await page.locator('.avatar').nth(1).evaluate(el => {
    const s = getComputedStyle(el); return [s.display, s.alignItems, s.justifyContent];
  });
  assert.deepEqual(style, ['flex', 'center', 'center']);
}
