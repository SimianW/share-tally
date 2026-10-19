// Host-wide lock for heavy checks (browser scenarios, server tests, the gate),
// so runs from different worktrees on one machine queue instead of overlapping.
//   node scripts/heavy-lock.mjs <command> [args...]   runs the command under the lock
//   holdHeavyCheckLock()                               holds it for this process
// The lock is a kernel flock on $SHARE_TALLY_HEAVY_LOCK, so it is released when
// its holder exits or is killed. Holders set SHARE_TALLY_HEAVY_LOCK_HELD=1, and
// nested heavy checks inherit it and run without waiting.
import { spawn, spawnSync } from 'node:child_process';
import { openSync, readFileSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

export function holdHeavyCheckLock(description = process.argv.slice(1).join(' ')) {
  if (process.env.SHARE_TALLY_HEAVY_LOCK_HELD === '1') return;
  const path = process.env.SHARE_TALLY_HEAVY_LOCK || '/tmp/share-tally-heavy-checks.lock';
  // Node opens files close-on-exec, so this process alone keeps the lock: flock(1)
  // locks the shared open file, and the lock outlives flock but not this process.
  // Append mode keeps the holder's details readable while others wait.
  const fd = openSync(path, 'a');
  const flock = options => spawnSync('flock', [...options, '3'], { stdio: ['ignore', 'inherit', 'inherit', fd] });
  const attempt = flock(['-n']);
  if (attempt.error) {
    console.error(`heavy-lock: flock unavailable (${attempt.error.code}); running without the heavy-check lock.`);
    return;
  }
  if (attempt.status !== 0) {
    const holder = readFileSync(path, 'utf8').trim() || 'an unknown process';
    console.error(`heavy-lock: waiting for ${path}, held by ${holder}`);
    const wait = flock([]);
    if (wait.status !== 0) throw new Error(`flock exited with ${wait.status ?? wait.signal} while waiting for ${path}`);
  }
  writeFileSync(path, `pid ${process.pid} since ${new Date().toISOString()} in ${process.cwd()}: ${description}\n`);
  process.env.SHARE_TALLY_HEAVY_LOCK_HELD = '1';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  holdHeavyCheckLock([command, ...args].join(' '));
  const child = spawn(command, args, { stdio: 'inherit' });
  // A terminal's Ctrl-C already reaches the whole process group; other signals
  // are forwarded, and the lock is kept until the command has finished.
  process.on('SIGINT', () => {});
  for (const signal of ['SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exit(127); });
  child.on('exit', (code, signal) => process.exit(code ?? 128 + constants.signals[signal]));
}
