import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
const vite = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await vite.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const base = vite.resolvedUrls.local[0];
  await page.route(base, async route => route.fulfill({
    contentType: 'text/html',
    body: await vite.transformIndexHtml('/', '<html><body></body></html>'),
  }));
  await page.goto(base);
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Avatar } = await import('/src/play/ui.tsx');
    await import('/src/play/play.css');
    await import('/src/play/bills.css');
    const root = document.createElement('div'); document.body.replaceChildren(root);
    createRoot(root).render(React.createElement('div', { className: 'bill-person' },
      React.createElement(Avatar, { name: 'Simon', imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/%3E' }),
      React.createElement(Avatar, { name: 'Bob' }),
      React.createElement(Avatar, { name: 'Carol', imageUrl: '/broken-avatar.png' }),
      React.createElement(Avatar, { name: 'David', imageUrl: '/broken-google.png', fallbackImageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/%3E' })));
  });
  await page.locator('.avatar').first().waitFor();
  await expect(page.locator('.avatar').nth(2)).toHaveText('C');
  await expect(page.locator('.avatar').nth(3).locator('img')).toHaveAttribute('src', /^data:image/);
  assert.equal(await page.locator('.avatar').first().locator('img').count(), 1, 'Provided profile image must render');
  assert.equal(await page.locator('.avatar').nth(2).innerText(), 'C', 'Broken image falls back to initial');
  const style = await page.locator('.avatar').nth(1).evaluate(el => {
    const s = getComputedStyle(el); return [s.display, s.alignItems, s.justifyContent];
  });
  assert.deepEqual(style, ['flex', 'center', 'center']);
  console.log('Avatar image, fallback, and bill centering passed');
} finally { await browser.close(); await vite.close(); }
