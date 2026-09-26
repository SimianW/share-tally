import { expect } from '@playwright/test';
import { openGroupSwitcher } from './smoke-navigation.mjs';

// Successful membership writes must remain visible even when the list read fails.
export async function checkGroupRefresh(pageFor, base) {
  const owner = await pageFor('member-15-token', { width: 1280, height: 900 });
  const joiner = await pageFor('member-16-token', { width: 390, height: 844 });
  const name = 'Refresh failure group';
  try {
    await owner.goto(base);
    await expect(owner.getByText('Start with a group for your next shared purchase.')).toBeVisible();
    await owner.route('**/api/groups', route => route.request().method() === 'GET'
      ? route.fulfill({ status: 503, json: { error: 'Group list temporarily unavailable.' } }) : route.continue());
    await owner.getByRole('button', { name: 'New group', exact: true }).click();
    await owner.getByLabel('Group name').fill(name);
    await owner.getByRole('button', { name: 'Create group', exact: true }).click();
    await expect(owner.getByRole('dialog')).toContainText(name);
    await owner.getByRole('button', { name: 'Get invitation link', exact: true }).click();
    const link = await owner.getByLabel('Invitation link', { exact: true }).inputValue();
    await owner.getByRole('button', { name: 'Close dialog', exact: true }).click();
    // Closing the new group's details leaves its creator on that group's page.
    await expect(owner).toHaveURL(/#\/group-bills\//);
    await expect(owner.locator('#main-content').getByRole('heading', { name })).toBeVisible();
    // The group list failure shows where it matters: in the group switcher.
    let switcher = await openGroupSwitcher(owner);
    await expect(switcher.getByRole('option', { name, exact: true })).toHaveCount(1);
    await expect(owner.locator('.group-switcher').getByRole('alert')).toContainText('Group list temporarily unavailable.');
    await owner.screenshot({ path: new URL('../test-results/group-switcher-error-desktop.png', import.meta.url).pathname, animations: 'disabled' });
    await owner.unroute('**/api/groups');
    await owner.getByRole('button', { name: 'Retry groups', exact: true }).click();
    await expect(owner.locator('.group-switcher').getByRole('alert')).toHaveCount(0);
    switcher = await openGroupSwitcher(owner);
    await expect(switcher.getByRole('option', { name, exact: true })).toHaveCount(1);
    await owner.keyboard.press('Escape');

    await joiner.goto(base);
    await expect(joiner.getByText('Start with a group for your next shared purchase.')).toBeVisible();
    await joiner.route('**/api/groups', route => route.fulfill({ status: 503, json: { error: 'Group list temporarily unavailable.' } }));
    // Repeat joining also exercises replacement rather than duplicate insertion.
    for (let attempt = 0; attempt < 2; attempt++) {
      await joiner.evaluate(hash => { location.hash = hash; }, new URL(link).hash);
      await joiner.getByRole('button', { name: 'Join group', exact: true }).click();
      // Accepting an invitation lands on the joined group's page.
      await expect(joiner).toHaveURL(/#\/group-bills\//);
      await expect(joiner.getByRole('dialog')).toHaveCount(0);
      await expect(joiner.locator('.group-member-count')).toContainText('2 members');
      await expect((await openGroupSwitcher(joiner)).getByRole('option', { name, exact: true })).toHaveCount(1);
      await joiner.keyboard.press('Escape');
    }
    await joiner.getByRole('link', { name: 'ShareTally home', exact: true }).click();
    await expect(joiner.locator('.group-card').filter({ hasText: name })).toHaveCount(1);
    await joiner.unroute('**/api/groups');
    await joiner.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(joiner.locator('.group-card').filter({ hasText: name })).toHaveCount(1);
    console.log('Group refresh regression passed: create/join survive list failure, retry recovers, repeated joins do not duplicate.');
  } finally { await owner.context().close(); await joiner.context().close(); }
}
