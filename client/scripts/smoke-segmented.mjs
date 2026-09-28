import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// Chooses `name` in a shared segmented control and follows its selection
// indicator frame by frame. The indicator must end on the chosen segment;
// it must pass through positions in between unless motion is reduced, in
// which case it is already there on the first frame.
export async function expectSegmentSlide(group, name, { reduced = false } = {}) {
  const radio = group.getByRole('radio', { name, exact: true });
  const input = await radio.elementHandle();
  const { start, frames, target } = await group.evaluate(async (root, input) => {
    const left = () => root.querySelector('.segmented-indicator')?.getBoundingClientRect().left ?? null;
    const start = left();
    input.focus();
    input.click();
    const frames = [];
    const until = performance.now() + 700;
    while (performance.now() < until) {
      await new Promise(requestAnimationFrame);
      frames.push(left());
    }
    const box = input.closest('.segmented-option').getBoundingClientRect();
    return { start, frames, target: box.left };
  }, input);
  await expect(radio).toBeChecked();
  assert.equal(await group.locator('.segmented-indicator').count(), 1, 'One indicator per control');
  assert.ok(Math.abs(frames.at(-1) - target) < 1, `The indicator ends on ${name}`);
  if (reduced) {
    assert.ok(Math.abs(frames[0] - target) < 1, `With reduced motion the indicator jumps to ${name}`);
  } else {
    const low = Math.min(start, target) + 2;
    const high = Math.max(start, target) - 2;
    assert.ok(frames.some(x => x > low && x < high), `The indicator slides to ${name}`);
  }
}
