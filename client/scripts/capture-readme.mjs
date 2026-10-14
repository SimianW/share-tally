// Capture visitor screenshots with fictional data; never part of the browser gate.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { serverRequire, startEnvironment } from '../test/browser/environment.mjs';
import { costcoFriends } from '../test/browser/groups/fixtures.mjs';
import { groupNet } from '../test/browser/ui.mjs';

const output = fileURLToPath(new URL('../../docs/images/', import.meta.url));
const sharp = serverRequire('sharp');
const env = await startEnvironment();
try {
  await mkdir(output, { recursive: true });
  const { group, ids, billsUrl } = await costcoFriends(env, { name: 'Weekend shopping' });
  const participants = [ids.Alice, ids.Bob, ids.Carol];
  // Seed through the public API, including each person's own confirmation.
  async function completeBill(token, title, totalCents, shareCents) {
    let { bill } = await env.api(`/groups/${group.id}/bills`, token, 'POST', {
      requestId: randomUUID(), title, purchaseDate: '2026-10-10',
      timeZone: 'America/Toronto', notes: '', totalCents, participantIds: participants,
    });
    for (const member of ['alice-token', 'bob-token', 'carol-token']) {
      ({ bill } = await env.api(`/bills/${bill.id}/share`, member, 'POST', {
        revision: bill.revision, expectedAmountCents: null, amountCents: shareCents,
      }));
    }
    assert.ok(bill.completedAt);
  }
  await completeBill('alice-token', 'Saturday groceries', 9000, 3000);
  await completeBill('bob-token', 'Dinner together', 6000, 2000);
  await completeBill('carol-token', 'Picnic supplies', 3000, 1000);

  // A synthetic receipt: no real shop, customer, address or payment details.
  const rows = [['Apples', 600], ['Bread', 400], ['Milk', 800], ['Dish soap', 1000]];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="620">
    <rect width="480" height="620" fill="#fffdf7"/>
    <g fill="#262626" font-family="monospace" font-size="22">
      <text x="100" y="65" font-size="30">SAMPLE SHOP</text>
      <text x="85" y="105" font-size="17">FICTIONAL RECEIPT · CAD</text>
      <text x="35" y="165">2026-10-10</text>
      ${rows.map(([name, cents], index) => `<text x="35" y="${225 + index * 52}">${name}</text><text x="355" y="${225 + index * 52}">${(cents / 100).toFixed(2)}</text>`).join('')}
      <text x="35" y="465">Subtotal</text><text x="355" y="465">28.00</text>
      <text x="35" y="505">Tax</text><text x="370" y="505">1.30</text>
      <text x="35" y="565" font-weight="bold">TOTAL</text><text x="355" y="565" font-weight="bold">29.30</text>
    </g></svg>`;
  const photo = await sharp(Buffer.from(svg)).png().toBuffer();
  const draftId = randomUUID();
  const data = {
    mode: 'items', title: 'Shared shopping', purchaseDate: '2026-10-10',
    timeZone: 'America/Toronto', notes: 'Claim the items you took home.',
    totalCents: 2930, participantIds: participants,
    receipt: { subtotalCents: 2800, discountCents: 0, taxCents: 130, extraCents: 0, pricesIncludeTax: false },
    items: rows.map(([name, amountCents], index) => ({
      id: randomUUID(), name, originalText: name.toUpperCase(), quantity: '1',
      amountCents, discountCents: 0, taxable: index === 3,
      finalCents: amountCents + (index === 3 ? 130 : 0), manualFinal: false,
    })),
  };
  const { draft: withPhoto } = await env.api(`/groups/${group.id}/receipt-drafts/${draftId}`, 'alice-token', 'PUT', {
    revision: 0, data, photoBase64: photo.toString('base64'),
  });
  data.receipt.evidence = { pages: [{ pageNumber: 1, width: 480, height: 620, unit: 'pixel' }], taxDetails: [{ rate: 0.13 }] };
  data.items.forEach((item, index) => {
    const top = 200 + index * 52;
    item.evidence = { regions: [{ pageNumber: 1, polygon: [25, top, 455, top, 455, top + 32, 25, top + 32] }] };
  });
  const { draft } = await env.api(`/groups/${group.id}/receipt-drafts/${draftId}`, 'alice-token', 'PUT', {
    revision: withPhoto.revision, data,
  });
  const alice = await env.pageFor('alice-token', { width: 1440, height: 1400 });
  await alice.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  async function capture(page, filename, fullPage = true) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await page.mouse.move(0, 0);
    const png = await page.screenshot({ fullPage, animations: 'disabled' });
    const path = `${output}${filename}`;
    await sharp(png).png({ compressionLevel: 9, palette: true, quality: 100 }).toFile(path);
    console.log(`Captured ${path}`);
  }
  await alice.goto(`${env.base}#/new-bill/${group.id}/${draftId}`);
  await alice.getByRole('navigation', { name: 'New bill steps' }).getByRole('button', { name: /Items$/ }).click();
  await expect(alice.getByRole('heading', { name: 'Check your items' })).toBeVisible();
  await expect(alice.getByRole('button', { name: 'Edit Dish soap', exact: true })).toBeVisible();
  await expect(alice.getByRole('img', { name: 'Original cropped receipt', exact: true })).toBeVisible();
  await capture(alice, 'receipt-review-desktop.png', false);
  await alice.setViewportSize({ width: 1440, height: 1000 });

  const { bill } = await env.api(`/receipt-drafts/${draftId}/initialize`, 'alice-token', 'POST', { revision: draft.revision });
  const reviewedItems = bill.items.map(({ id, version }) => ({ itemId: id, version }));
  for (const token of ['alice-token', 'bob-token']) {
    await env.api(`/bills/${bill.id}/claims`, token, 'POST', {
      reviewedItems, claims: [
        { itemId: data.items[0].id, numerator: 1, denominator: 3 },
        { itemId: data.items[1].id, numerator: 1, denominator: 2 },
        ...(token === 'alice-token' ? [{ itemId: data.items[2].id, numerator: 1, denominator: 1 }] : []),
      ],
    });
  }
  await alice.goto(billsUrl);
  await expect(groupNet(alice)).toContainText('$30.00');
  await expect(alice.getByRole('region', { name: 'Group balances and repayments' })).toContainText('Carol');
  await capture(alice, 'group-balances-desktop.png');

  const mobile = await env.pageFor('alice-token', { width: 390, height: 844 });
  await mobile.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await mobile.goto(billsUrl);
  await expect(groupNet(mobile)).toContainText('$30.00');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture(mobile, 'group-balances-mobile.png');
  assert.deepEqual(env.errors, []);
  assert.equal(env.networkChangeFailures.size, 0);
} finally {
  await env.dispose();
}
