// Receipt scenario: note photos, from a new bill's Notes block to the shared bill.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { receiptEnvironment, receiptGroup, receiptPhoto } from './fixtures.mjs';
import { serverRequire } from '../environment.mjs';

export const scenarios = [
  { name: 'note-photos', environment: receiptEnvironment, run: notePhotos },
];

// A large phone picture uploads compressed, the add control stops at three,
// ✕ removes one, and the shared bill shows them to open full screen.
async function notePhotos(env) {
  const { api } = env;
  const { group, alice, expectNewBillRoute } = await receiptGroup(env);
  const sharp = serverRequire('sharp');
  // Smooth noise scaled up, as detailed as a photo: far over the upload limit as picked.
  const noise = await sharp({ create: { width: 400, height: 300, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer();
  const phonePhoto = await sharp(noise).resize(4000, 3000, { kernel: 'cubic' }).jpeg({ quality: 98 }).toBuffer();
  assert.ok(phonePhoto.length > 3 * 1024 * 1024, `${phonePhoto.length} bytes`);

  await alice.getByRole('button', { name: 'New bill', exact: true }).click();
  await expectNewBillRoute();
  const method = alice.getByRole('radiogroup', { name: 'How to split this bill' });
  await method.getByRole('radio', { name: 'By amount' }).check();
  await alice.getByLabel('Total to split', { exact: true }).fill('30');
  await alice.getByRole('button', { name: 'Continue to people', exact: true }).click();
  await alice.getByLabel('Bill title', { exact: true }).fill('Costco run');
  const photos = alice.getByRole('group', { name: 'Note photos' });
  const chooser = alice.getByLabel('Choose note photos', { exact: true });
  const add = photos.getByRole('button', { name: 'Add photos', exact: true });
  await expect(add).toBeVisible();
  await expect(photos.getByText('0 of 3 photos')).toBeVisible();

  // The new bill is saved first, since a note photo belongs to a saved draft.
  const uploaded = alice.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/note-photos'));
  await chooser.setInputFiles({ name: 'shelf.jpg', mimeType: 'image/jpeg', buffer: phonePhoto });
  const body = Buffer.from(JSON.parse((await uploaded).postData()).base64, 'base64');
  assert.ok(body.length < 1.5 * 1024 * 1024, `upload of ${body.length} bytes`);
  const sent = await sharp(body).metadata();
  assert.equal(sent.format, 'jpeg');
  assert.deepEqual([sent.width, sent.height], [2048, 1536]);
  await expect(photos.getByRole('img', { name: 'Note photo 1', exact: true })).toBeVisible();
  const [draft] = (await api(`/groups/${group.id}/receipt-drafts`)).drafts;
  assert.equal(draft.data.title, 'Costco run');
  assert.equal((await api(`/receipt-drafts/${draft.id}`)).draft.notePhotos.length, 1);

  // A picture the browser cannot decode says which formats to choose.
  await chooser.setInputFiles({ name: 'IMG_0001.heic', mimeType: 'image/heic', buffer: Buffer.from('not decodable here') });
  await expect(photos.getByRole('alert')).toHaveText("This browser can't open that picture. Choose a JPEG, PNG or WebP image.");
  await photos.getByRole('button', { name: 'Dismiss photo that was not added', exact: true }).click();
  await expect(photos.getByRole('alert')).toHaveCount(0);

  // Two at once fill the remaining slots; the add control then goes away.
  await chooser.setInputFiles([
    { name: 'tag.png', mimeType: 'image/png', buffer: await receiptPhoto(300, 200, '#d33') },
    { name: 'division.png', mimeType: 'image/png', buffer: await receiptPhoto(200, 300, '#33d') },
  ]);
  for (const index of [1, 2, 3]) await expect(photos.getByRole('img', { name: `Note photo ${index}`, exact: true })).toBeVisible();
  await expect(photos.getByText('3 of 3 photos · Remove one to add another')).toBeVisible();
  await expect(add).toHaveCount(0);
  await expect(chooser).toHaveCount(0);

  await photos.getByRole('button', { name: 'Remove note photo 2', exact: true }).click();
  await expect(photos.getByRole('img', { name: /^Note photo/ })).toHaveCount(2);
  await expect(add).toBeVisible();
  const kept = (await api(`/receipt-drafts/${draft.id}`)).draft.notePhotos;
  assert.equal(kept.length, 2);

  // Sharing keeps the draft's photos on the bill, where they open full screen.
  await alice.getByRole('button', { name: 'Share bill', exact: true }).click();
  const notes = alice.getByRole('list', { name: 'Note photos' });
  await expect(notes.getByRole('button', { name: /^View note photo/ })).toHaveCount(2);
  const billId = alice.url().split('/').at(-1);
  assert.deepEqual((await api(`/bills/${billId}`)).bill.notePhotos, kept);
  await notes.getByRole('button', { name: 'View note photo 1', exact: true }).click();
  const viewer = alice.getByRole('dialog', { name: 'Note photo 1 of 2' });
  await expect(viewer.getByRole('img', { name: 'Full-size note photo 1', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(viewer.getByLabel('Photo zoom')).not.toHaveText('100%');
  await viewer.getByRole('button', { name: 'Close photo', exact: true }).click();
  await expect(viewer).toHaveCount(0);

  // The initiated bill's edit form shares the editor; a photo saves without the form.
  await alice.getByRole('button', { name: 'Edit details & participants', exact: true }).click();
  const dialog = alice.getByRole('dialog', { name: 'Edit bill' });
  await dialog.getByLabel('Choose note photos', { exact: true })
    .setInputFiles({ name: 'forgot.png', mimeType: 'image/png', buffer: await receiptPhoto(120, 90, '#3d3') });
  await expect(dialog.getByRole('img', { name: 'Note photo 3', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep current bill', exact: true }).click();
  await expect(notes.getByRole('button', { name: /^View note photo/ })).toHaveCount(3);
  const bill = (await api(`/bills/${billId}`)).bill;
  assert.equal(bill.notePhotos.length, 3);
  assert.equal(bill.revision, 1);
}
