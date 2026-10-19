// Host-wide lock for heavy checks (browser scenarios, server tests, the gate),
// so runs from different worktrees on one machine queue instead of overlapping.
//   node scripts/heavy-lock.mjs <command> [args...]   runs the command under the lock
//   holdHeavyCheckLock()                               holds it for this process
// The lock is a kernel flock on $SHARE_TALLY_HEAVY_LOCK, released when the last
// process holding the locked file exits or is killed. Holders set
// SHARE_TALLY_HEAVY_LOCK_HELD=1, and nested heavy checks inherit it and run
// without waiting.
import { spawn, spawnSync } from 'node:child_process';
import { constants as fs, ftruncateSync, openSync, readSync, writeSync } from 'node:fs';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

// Returns the locked file descriptor, or undefined when no lock was taken here.
export function holdHeavyCheckLock(description = process.argv.slice(1).join(' ')) {
  if (process.env.SHARE_TALLY_HEAVY_LOCK_HELD === '1') return undefined;
  const path = process.env.SHARE_TALLY_HEAVY_LOCK || '/tmp/share-tally-heavy-checks.lock';
  // Node opens files close-on-exec, so only processes given this fd keep the lock:
  // flock(1) locks the shared open file, and the lock outlives flock.
  // The path is fixed and shared, so refuse a symlink planted there rather than
  // write through it, and read and write the holder's details only through this fd.
  let fd;
  try {
    fd = openSync(path, fs.O_RDWR | fs.O_CREAT | fs.O_NOFOLLOW, 0o644);
  } catch (error) {
    const reason = error.code === 'ELOOP' ? 'it is a symlink' : error.code;
    console.error(`heavy-lock: cannot open ${path} (${reason}); remove it or set SHARE_TALLY_HEAVY_LOCK to another path.`);
    process.exit(1);
  }
  const flock = options => spawnSync('flock', [...options, '3'], { stdio: ['ignore', 'inherit', 'inherit', fd] });
  const attempt = flock(['-n']);
  if (attempt.error) {
    console.error(`heavy-lock: flock unavailable (${attempt.error.code}); running without the heavy-check lock.`);
    // Nested checks must not try again: the shell entrypoints would re-exec forever.
    process.env.SHARE_TALLY_HEAVY_LOCK_HELD = '1';
    return undefined;
  }
  if (attempt.status !== 0) {
    const buffer = Buffer.alloc(4096);
    const holder = buffer.toString('utf8', 0, readSync(fd, buffer, 0, buffer.length, 0)).trim() || 'an unknown process';
    console.error(`heavy-lock: waiting for ${path}, held by ${holder}. This run starts once the holder exits, `
      + 'which can take many minutes; run heavy checks in the background or with a long tool timeout.');
    const wait = flock([]);
    if (wait.status !== 0) throw new Error(`flock exited with ${wait.status ?? wait.signal} while waiting for ${path}`);
  }
  ftruncateSync(fd);
  writeSync(fd, `pid ${process.pid} since ${new Date().toISOString()} in ${process.cwd()}: ${description}\n`, 0);
  process.env.SHARE_TALLY_HEAVY_LOCK_HELD = '1';
  return fd;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const fd = holdHeavyCheckLock([command, ...args].join(' '));
  // The command gets the locked file as fd 3, and so do descendants that inherit
  // it, so the lock lasts until the last of them exits, even if this wrapper is
  // killed first. A Node process keeps the fd but does not pass it on to its own
  // children.
  const child = spawn(command, args, { stdio: ['inherit', 'inherit', 'inherit', ...(fd === undefined ? [] : [fd])] });
  // A terminal's Ctrl-C also reaches the child directly; forwarding covers a
  // signal sent to this process alone.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exit(127); });
  child.on('exit', (code, signal) => process.exit(code ?? 128 + constants.signals[signal]));
}
