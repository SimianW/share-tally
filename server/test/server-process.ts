import { createApp } from '../src/app.js';
import { closeDatabase } from '../src/db/index.js';

// Only this test entry point knows these tokens. Production always uses Clerk.
const identities = new Map([
  ['Bearer alice-token', 'user_test_alice'],
  ['Bearer bob-token', 'user_test_bob'],
  ['Bearer carol-token', 'user_test_carol'],
]);
for (let i = 1; i <= 17; i++)
  identities.set(`Bearer member-${i}-token`, `user_test_member_${i}`);
const app = createApp({
  displayName: async id => ({ user_test_alice: 'Alice', user_test_bob: 'Bob', user_test_carol: 'Carol' })[id] ?? 'Member',
  middleware: (_req, _res, next) => next(),
  userId: (req) => identities.get(req.get('authorization') ?? '') ?? null,
});
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') process.send?.(address.port);
});
process.once('SIGTERM', () => {
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  server.closeAllConnections();
});
