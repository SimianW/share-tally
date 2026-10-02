// Setup shared by receipt scenarios: a group, Alice's page and receipt photos.
// Clicks and assertions stay in the scenarios.
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { serverRequire } from '../environment.mjs';

// Non-loopback HTTP reproduces the remote development browser's security context.
export const receiptEnvironment = { remoteHost: 'receipt.test' };

// Alice's "Receipt friends" group with Bob and Carol, and Alice's desktop page on it.
export async function receiptGroup(env) {
  const { api, base } = env;
  const { group } = await api('/groups', 'alice-token', 'POST', {
    name: 'Receipt friends',
    icon: { type: 'unicode', value: '🛒' },
  });
  const invitation = await api(`/groups/${group.id}/invitation`);
  for (const token of ['bob-token', 'carol-token'])
    await api('/groups/join', token, 'POST', { token: invitation.path.split('/').at(-1) });
  const members = (await api(`/groups/${group.id}`)).group.members;
  const memberIds = Object.fromEntries(members.map(member => [member.displayName, member.id]));
  const groupRoute = `${base}#/group-bills/${group.id}`;
  const newBillRoute = `${base}#/new-bill/${group.id}`;
  const alice = await env.pageFor('alice-token', { width: 1280, height: 1000 });
  await alice.goto(groupRoute);
  // Scenarios start from a loaded group page, as they did in the sequential suite.
  await expect(alice.getByRole('button', { name: 'New bill', exact: true })).toBeVisible();
  const stepButton = label => alice.getByRole('navigation', { name: 'New bill steps' })
    .getByRole('button', { name: new RegExp(`${label}$`) });
  const expectNewBillRoute = async draftId => {
    await expect(alice).toHaveURL(draftId ? `${newBillRoute}/${draftId}` : newBillRoute);
    await expect(alice.getByRole('navigation', { name: 'New bill steps' })).toBeVisible();
    for (const label of ['Receipt', 'Items', 'People'])
      await expect(stepButton(label)).toBeVisible();
    await expect(alice.locator('dialog[open]')).toHaveCount(0);
  };
  // A saved, titled draft with no items, so a scan starts from the receipt step.
  const titledDraft = async title => {
    const draftId = randomUUID();
    await api(`/groups/${group.id}/receipt-drafts/${draftId}`, 'alice-token', 'PUT', {
      revision: 0,
      data: {
        mode: 'items', title, purchaseDate: '2026-09-24', timeZone: 'America/Toronto',
        notes: '', totalCents: null, participantIds: [memberIds.Alice], items: [],
        receipt: { subtotalCents: null, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      },
    });
    return draftId;
  };
  return { group, members, memberIds, groupRoute, newBillRoute, alice, stepButton, expectNewBillRoute, titledDraft };
}

// A plain PNG standing in for a receipt photo.
export function receiptPhoto(width, height, background = '#f8f8f2') {
  return serverRequire('sharp')({ create: { width, height, channels: 3, background } }).png().toBuffer();
}

export const claimSheet = (page, name = 'Apples') => page.getByRole('dialog', { name, exact: true });
export const itemOption = (page, label, name = 'Apples') => claimSheet(page, name).getByRole('button', { name: label, exact: true });
// The Items step's receipt summary button.
export const reconciliationButton = page => page.getByRole('button', { name: /Matches receipt|Off by|Receipt summary/ }).filter({ hasText: /Items/ });
export const processingTitle = 'Naming items and checking tax…';
