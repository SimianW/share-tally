import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectScenarios } from '../test/browser/selection.mjs';

const suites = {
  groups: [{ name: 'group-refresh' }, { name: 'repayments' }],
  receipts: [{ name: 'scan-retry' }],
  avatar: [{ name: 'avatar' }],
};
const labels = selection => selection.scenarios.map(({ suite, name }) => `${suite}/${name}`);

test('--all selects every scenario of every suite in suite order', () => {
  assert.deepEqual(labels(selectScenarios(suites, ['--all'])), ['groups/group-refresh', 'groups/repayments', 'receipts/scan-retry', 'avatar/avatar']);
});

test('suite names select whole suites and scenario names narrow them', () => {
  assert.deepEqual(labels(selectScenarios(suites, ['groups', 'receipts'])), ['groups/group-refresh', 'groups/repayments', 'receipts/scan-retry']);
  assert.deepEqual(labels(selectScenarios(suites, ['groups', 'repayments'])), ['groups/repayments']);
});

test('unknown names are reported instead of selecting nothing', () => {
  assert.deepEqual(selectScenarios(suites, ['--all', 'reciepts']), { unknown: ['reciepts'], scenarios: [] });
});
