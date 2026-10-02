import type { db } from './index.js';

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
