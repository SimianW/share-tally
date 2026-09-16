// No database connection is opened by this benchmark.
import { performance } from 'node:perf_hooks';
import { minimumRepayments } from '../src/group-ledger.js';

const cases = {
  'one component': [-1, -2, -4, -8, -16, -32, -64, -128, -256, -512, -1024, -2048, -4096, -8192, -16384, 32767],
  'eight components': [-1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8],
};
for (const [name, balances] of Object.entries(cases)) {
  const members = balances.map((netCents, i) => ({ userId: String(i).padStart(2, '0'), displayName: String(i), netCents }));
  const times = [];
  for (let i = 0; i < 25; i++) {
    const start = performance.now();
    minimumRepayments(members);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(`${name}: median ${times[12].toFixed(2)} ms, maximum ${times[24].toFixed(2)} ms, 16 members / 25 runs`);
}
