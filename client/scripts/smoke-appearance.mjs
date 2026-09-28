import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { expectSegmentSlide } from './smoke-segmented.mjs';

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
    // Query the cards, not [data-palette], which also matches <html> once a palette is applied.
    const marigold = document.querySelector('.appearance-option[data-palette="marigold"]');
    const raspberry = document.querySelector('.appearance-option[data-palette="raspberry"]');
    return [getComputedStyle(marigold).getPropertyValue('--action').trim(), getComputedStyle(raspberry).getPropertyValue('--action').trim(), getComputedStyle(document.documentElement).getPropertyValue('--action').trim()];
  });
  assert.notEqual(scopedActions[0], scopedActions[1], 'Each palette card resolves its own action token');
  assert.equal(scopedActions[1], scopedActions[2], 'The selected card matches the app palette token');
  // Each card previews its own body font, even when the app palette differs.
  const cardFonts = await page.evaluate(() => Object.fromEntries(['classic', 'raspberry', 'lagoon', 'blueberry'].map(key =>
    [key, getComputedStyle(document.querySelector(`.appearance-option[data-palette="${key}"] small`)).fontFamily])));
  assert.match(cardFonts.classic, /DM Sans/, 'Classic card keeps its own body font under Raspberry');
  assert.match(cardFonts.raspberry, /Figtree/, 'Raspberry card previews Figtree');
  assert.match(cardFonts.lagoon, /Instrument Sans/, 'Lagoon card previews Instrument Sans');
  assert.match(cardFonts.blueberry, /Figtree/, 'Blueberry card previews Figtree');

  const screenshots = '/tmp/st-pr-100';
  await mkdir(screenshots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${screenshots}/account-desktop.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Account overflows at 390px');
  await page.screenshot({ path: `${screenshots}/account-mobile.png`, fullPage: true, animations: 'disabled' });

  await page.addInitScript(() => {
    // "interactive" fires before deferred module scripts run, so the palette
    // must already be set by the parser-blocking bootstrap in index.html.
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive') {
        window.__paletteBeforeModules = document.documentElement.dataset.palette ?? null;
        window.__schemeBeforeModules = document.documentElement.dataset.scheme ?? null;
      }
    });
    document.addEventListener('DOMContentLoaded', () => {
      window.__paletteAtDOMContentLoaded = document.documentElement.dataset.palette ?? null;
    }, { once: true });
  });
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: /Raspberry/ })).toBeChecked();
  assert.equal(await page.evaluate(() => window.__paletteBeforeModules), 'raspberry', 'Palette must apply before any module script, so styles never paint Classic first');
  assert.equal(await page.evaluate(() => window.__paletteAtDOMContentLoaded), 'raspberry', 'Palette must apply by DOMContentLoaded before hydration');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'raspberry', 'Palette remains applied after hydration');

  // Mode is independent of palette: "Match device" follows the OS live, and
  // an explicit choice is applied before any module script on reload.
  const mode = page.getByRole('radiogroup', { name: 'Mode' });
  const scheme = () => page.evaluate(() => document.documentElement.dataset.scheme);
  await expect(mode.getByRole('radio', { name: 'Match device' })).toBeChecked();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(scheme).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(scheme).toBe('light');
  // Mode is the shared segmented control: its indicator slides, jumps under
  // reduced motion, and the arrow keys choose as they do for any radio group.
  await expectSegmentSlide(mode, 'Light');
  assert.equal(await scheme(), 'light');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectSegmentSlide(mode, 'Dark', { reduced: true });
  assert.equal(await scheme(), 'dark');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('ArrowLeft');
  await expect(mode.getByRole('radio', { name: 'Light' })).toBeChecked();
  assert.equal(await scheme(), 'light');
  await mode.getByRole('radio', { name: 'Dark' }).check();
  assert.equal(await scheme(), 'dark');
  assert.equal(await page.evaluate(() => localStorage.getItem('share-tally-scheme')), 'dark');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark', 'The dark palette block applies');
  await page.reload();
  assert.equal(await page.evaluate(() => window.__paletteBeforeModules), 'raspberry');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'raspberry', 'Changing mode keeps the palette');
  assert.equal(await page.evaluate(() => window.__schemeBeforeModules), 'dark', 'Saved dark mode must apply before any module script, even on a light device');
  assert.equal(await scheme(), 'dark', 'Dark mode survives a reload while the device is light');
  await page.evaluate(() => localStorage.setItem('share-tally-scheme', 'not-a-mode'));
  await page.reload();
  assert.equal(await page.evaluate(() => window.__schemeBeforeModules), 'light', 'An invalid stored mode follows the device');
  await expect(page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Match device' })).toBeChecked();
  assert.equal(await scheme(), 'light');
  // The radio is already checked, so clear the invalid value directly.
  await page.evaluate(() => localStorage.removeItem('share-tally-scheme'));
  assert.equal(await page.evaluate(() => localStorage.getItem('share-tally-scheme')), null);

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
  await page.getByRole('link', { name: 'ShareTally home', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'marigold', 'A session-only choice stays applied after navigation');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('radio', { name: /Marigold/ })).toBeChecked();
  console.log('Appearance smoke passed: picker, immediate application, pre-hydration reload, navigation persistence, invalid-value fallback, and blocked-storage recovery.');
}

// The bill summary card takes each palette's own accent tint (#107); Classic
// keeps its highlight fill. Screenshots of every palette go to test-results.
export async function checkBillCardPalettes(page, screenshots) {
  const palettes = ['classic', 'marigold', 'raspberry', 'plum-butter', 'lagoon', 'blueberry'];
  const fills = {};
  for (const palette of palettes) {
    const card = await page.evaluate(key => {
      document.documentElement.dataset.palette = key;
      const probe = document.createElement('div');
      probe.style.background = 'var(--surface-highlight)';
      document.body.append(probe);
      const highlight = getComputedStyle(probe).backgroundColor;
      probe.style.background = 'var(--palette-lime-tint)';
      const tint = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { fill: getComputedStyle(document.querySelector('.difference-card')).backgroundColor, highlight, tint };
    }, palette);
    if (palette === 'classic') assert.equal(card.fill, card.highlight, 'Classic keeps its highlight fill on the bill card');
    else assert.equal(card.fill, card.tint, `${palette} fills the bill card with its accent tint`);
    fills[palette] = card.fill;
    await page.locator('.difference-card').screenshot({ path: `${screenshots}/bill-card-${palette}.png`, animations: 'disabled' });
    await page.screenshot({ path: `${screenshots}/bill-page-${palette}.png`, fullPage: true, animations: 'disabled' });
  }
  assert.equal(new Set(Object.values(fills)).size, palettes.length, 'Every palette has its own bill card fill');
  await page.evaluate(() => { document.documentElement.dataset.palette = 'classic'; });
}
