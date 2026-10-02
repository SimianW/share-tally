import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moduleBoundaryViolations } from './check-module-boundaries.mjs';

test('allows imports within the same feature', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['features/groups/GroupPage.tsx', "import { view } from './GroupBills';"],
    ['features/groups/GroupBills.tsx', 'export const view = {};'],
  ])), []);
});

test('allows public cross-feature entries with or without extension from nested files', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['features/groups/pages/GroupFeature.tsx', "import { api } from '../../receipts/api.ts';"],
    ['features/groups/GroupFeature.tsx', "import { icon } from './icons/GroupIconView';"],
  ])), []);
});

test('rejects cross-feature implementation imports with the specifier line number', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['features/groups/GroupFeature.tsx', "import { view } from '../receipts/drafts/ReceiptDrafts';"],
  ])), [
    'features/groups/GroupFeature.tsx:1: features/groups imports features/receipts/drafts/ReceiptDrafts, which is not a public entry point of features/receipts; compose it in app',
  ]);
});

test('checks type-only imports', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['features/groups/GroupFeature.tsx', "import type { Receipt } from '../receipts/drafts/ReceiptDrafts';"],
  ])), [
    'features/groups/GroupFeature.tsx:1: features/groups imports features/receipts/drafts/ReceiptDrafts, which is not a public entry point of features/receipts; compose it in app',
  ]);
});

test('checks dynamic imports', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['features/groups/GroupFeature.tsx', "const load = () => import('../receipts/drafts/ReceiptDrafts');"],
  ])), [
    'features/groups/GroupFeature.tsx:1: features/groups imports features/receipts/drafts/ReceiptDrafts, which is not a public entry point of features/receipts; compose it in app',
  ]);
});

test('checks re-exports from another feature', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['features/groups/index.ts', "export { ReceiptDrafts } from '../receipts/drafts/ReceiptDrafts';"],
  ])), [
    'features/groups/index.ts:1: features/groups imports features/receipts/drafts/ReceiptDrafts, which is not a public entry point of features/receipts; compose it in app',
  ]);
});

test('checks multi-line imports using the specifier line number', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['features/groups/GroupFeature.tsx', "import {\n  ReceiptDrafts,\n} from '../receipts/drafts/ReceiptDrafts';"],
  ])), [
    'features/groups/GroupFeature.tsx:3: features/groups imports features/receipts/drafts/ReceiptDrafts, which is not a public entry point of features/receipts; compose it in app',
  ]);
});

test('prevents shared code from importing a feature', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['shared/ui/X.tsx', "import { api } from '../../features/bills/api';"],
  ])), ['shared/ui/X.tsx:1: shared must not import features/bills']);
});

test('checks side-effect imports before the next import statement', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['shared/ui/X.tsx', "import '../../features/bills/bills.css';\nimport React from 'react';"],
  ])), ['shared/ui/X.tsx:1: shared must not import features/bills']);
});

test('checks side-effect imports after ordinary statements', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['shared/ui/X.tsx', "export const x = 1;\nimport '../../features/bills/bills.css';\nimport React from 'react';"],
  ])), ['shared/ui/X.tsx:2: shared must not import features/bills']);
});

test('ignores comment markers inside strings when checking imports', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['shared/ui/X.tsx', "const accept = 'image/*';\nimport '../../features/bills/BillDetail';\n/* note */"],
    ['features/groups/G.tsx', "const url = 'https://x.test'; import y from '../../app/AppShell';"],
  ])), [
    'shared/ui/X.tsx:2: shared must not import features/bills',
    'features/groups/G.tsx:1: features/groups must not import app',
  ]);
});

test('allows TypeScript-resolvable JavaScript extensions on public entries', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['features/home/H.tsx', "import { a } from '../bills/api.js';"],
  ])), []);
});

test('prevents theme code from importing the app', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['theme/colors.ts', "import { app } from '../app/AppShell';"],
  ])), ['theme/colors.ts:1: theme must not import app']);
});

test('prevents features from importing the app', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['features/groups/GroupFeature.tsx', "import { app } from '../../app/AppShell';"],
  ])), ['features/groups/GroupFeature.tsx:1: features/groups must not import app']);
});

test('allows app composition of feature internals', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['app/GroupWorkspace.tsx', "import { drafts } from '../features/receipts/drafts/ReceiptDrafts';"],
  ])), []);
});

test('checks CSS imports from shared into a feature', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['shared/styles.css', '@import url("../features/bills/bills.css");'],
  ])), ['shared/styles.css:1: shared must not import features/bills']);
});

test('ignores imports written in comments', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['shared/ui/X.tsx', "// import X from '../../features/bills/api';\n/* import Y from '../../app/AppShell'; */"],
  ])), []);
});

test('ignores package imports', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['features/groups/GroupFeature.tsx', "import React from 'react';\nimport { useQuery } from '@tanstack/react-query';"],
  ])), []);
});

test('checks side-effect imports', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['features/groups/GroupFeature.tsx', "import '../receipts/drafts/styles.css';"],
  ])), [
    'features/groups/GroupFeature.tsx:1: features/groups imports features/receipts/drafts/styles, which is not a public entry point of features/receipts; compose it in app',
  ]);
});

test('checks unquoted CSS url imports', () => {
  assert.deepEqual(moduleBoundaryViolations(new Map([
    ['shared/styles.css', '@import url(../features/bills/bills.css);'],
  ])), ['shared/styles.css:1: shared must not import features/bills']);
});
