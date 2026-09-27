import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';

const storageKey = 'share-tally-palette';

export async function checkAppearance(page, base, groupUrl) {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Account', exact: true }).click();
  await expect(page).toHaveURL(`${base}#/account`);

  const appearance = page.getByRole('radiogroup', { name: 'Appearance' });
  await expect(appearance.getByRole('radio')).toHaveCount(6);
  await expect(appearance.getByRole('radio', { name: /Classic/ })).toBeChecked();
  await expect(page.getByText('Saved on this device.', { exact: true })).toBeVisible();
  await appearance.getByRole('radio', { name: /Raspberry/ }).check();
  await expect(appearance.getByRole('radio', { name: /Raspberry/ })).toBeChecked();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'raspberry');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), 'raspberry');
  const scopedActions = await page.evaluate(() => {
    const marigold = document.querySelector('[data-palette="marigold"]');
    const raspberry = document.querySelector('[data-palette="raspberry"]');
    return [getComputedStyle(marigold).getPropertyValue('--action').trim(), getComputedStyle(raspberry).getPropertyValue('--action').trim(), getComputedStyle(document.documentElement).getPropertyValue('--action').trim()];
  });
  assert.notEqual(scopedActions[0], scopedActions[1], 'Each palette card resolves its own action token');
  assert.equal(scopedActions[1], scopedActions[2], 'The selected card matches the app palette token');

  const screenshots = '/tmp/st-pr-100';
  await mkdir(screenshots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${screenshots}/account-desktop.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Account overflows at 390px');
  await page.screenshot({ path: `${screenshots}/account-mobile.png`, fullPage: true, animations: 'disabled' });

  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      window.__paletteAtDOMContentLoaded = document.documentElement.dataset.palette ?? null;
    }, { once: true });
  });
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: /Raspberry/ })).toBeChecked();
  assert.equal(await page.evaluate(() => window.__paletteAtDOMContentLoaded), 'raspberry', 'Palette must apply by DOMContentLoaded before hydration');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'raspberry', 'Palette remains applied after hydration');

  await page.goto(base);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'raspberry', 'Palette persists on Home');
  await page.goto(groupUrl);
  await expect(page.locator('#main-content')).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'raspberry', 'Palette persists on the group page');

  await page.evaluate(key => localStorage.setItem(key, 'not-a-palette'), storageKey);
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'classic', 'Invalid stored palette falls back to Classic');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: /Classic/ })).toBeChecked();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'classic', 'Invalid stored palette falls back to Classic');

  await page.addInitScript(key => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (name) {
      if (name === key) throw new Error('Storage access is blocked');
      return getItem.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new Error('Storage access is blocked');
      return setItem.call(this, name, value);
    };
  }, storageKey);
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'classic', 'Blocked palette reads fall back to Classic');
  await expect(page.getByText('Could not read the saved palette. Your changes may not persist.', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /Marigold/ }).check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'marigold', 'A selection still applies when writes are blocked');
  await expect(page.getByText('Palette applied for this session, but could not be saved on this device.', { exact: true })).toBeVisible();
  console.log('Appearance smoke passed: picker, immediate application, pre-hydration reload, navigation persistence, invalid-value fallback, and blocked-storage recovery.');
}
