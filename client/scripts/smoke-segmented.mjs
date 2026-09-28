import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// Clicks `name` in a shared segmented control while recording where its
// selection indicator is on every frame, until the indicator has settled on
// the chosen segment. It must pass through positions in between, or never
// when motion is reduced.
export async function expectSegmentSlide(group, name, { reduced = false } = {}) {
  const page = group.page();
  const radio = group.getByRole('radio', { name, exact: true });
  const start = await group.evaluate(root => {
    const indicator = () => root.querySelector('.segmented-indicator');
    const frames = window.__segmentFrames = [];
    const record = () => {
      frames.push(indicator()?.getBoundingClientRect().left ?? null);
      window.__segmentFrame = requestAnimationFrame(record);
    };
    record();
    return frames[0];
  });
  await radio.click();
  await expect(radio).toBeChecked();
  const target = await radio.evaluate(input => input.closest('.segmented-option').getBoundingClientRect().left);
  // Settled: the last few frames all sit on the chosen segment.
  await page.waitForFunction(target => {
    const recent = window.__segmentFrames.slice(-3);
    return recent.length === 3 && recent.every(left => left !== null && Math.abs(left - target) < 1);
  }, target);
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.__segmentFrame);
    return window.__segmentFrames;
  });
  assert.equal(await group.locator('.segmented-indicator').count(), 1, 'One indicator per control');
  assert.ok(await group.evaluate(root => root.scrollWidth <= root.clientWidth), 'Every segment fits on one row');
  const low = Math.min(start, target) + 2;
  const high = Math.max(start, target) - 2;
  const between = frames.some(left => left > low && left < high);
  if (reduced) assert.ok(!between, `With reduced motion the indicator jumps to ${name}`);
  else assert.ok(between, `The indicator slides to ${name}`);
}
