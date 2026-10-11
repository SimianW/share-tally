import { access, writeFile } from 'node:fs/promises';

// The API container's Compose health check. Until this container first reaches
// PostgreSQL it checks readiness, so `up --wait` records a release and web
// starts only when the API can serve requests. It then records that in the
// container's own temporary storage and checks liveness only, so an idle API
// lets the database suspend. After startup, healthy means only that the API
// process responds; call /api/health/ready by hand to check the database.
// Exits 0 when healthy, 1 otherwise.
const origin = process.env.HEALTHCHECK_ORIGIN ?? 'http://127.0.0.1:3000';
const marker = process.env.HEALTHCHECK_MARKER ?? '/tmp/share-tally-api-ready';

const ready = await access(marker).then(() => true, () => false);
try {
  // Within the Compose health check's five-second timeout.
  const response = await fetch(`${origin}${ready ? '/api/health' : '/api/health/ready'}`, {
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) process.exit(1);
  if (!ready) await writeFile(marker, '');
  process.exit(0);
} catch {
  process.exit(1);
}
