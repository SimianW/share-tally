import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const skippableScript = fileURLToPath(new URL('./browser-gate-skippable.sh', import.meta.url))
const gitIdentity = ['-c', 'user.name=Gate test', '-c', 'user.email=gate@example.invalid']

function git(cwd, ...args) {
  return execFileSync('git', [...gitIdentity, '-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

async function commitFiles(cwd, paths) {
  for (const path of paths) {
    await mkdir(dirname(join(cwd, path)), { recursive: true })
    await writeFile(join(cwd, path), `${path} ${Math.random()}\n`)
  }
  git(cwd, 'add', '--all')
  git(cwd, 'commit', '-q', '-m', `Change ${paths.join(', ')}`)
}

// A remote with main, and a clone on a feature branch, as Drone checks it out.
async function branchClone(t, { branch = 'feature', cloneArgs = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'share-tally-gate-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const remote = join(root, 'remote')
  execFileSync('git', ['init', '-q', '--initial-branch=main', remote])
  await commitFiles(remote, ['client/src/main.ts', 'docs/operations.md', 'README.md'])
  await commitFiles(remote, ['server/src/index.ts'])
  const clone = join(root, 'clone')
  execFileSync('git', ['clone', '-q', ...cloneArgs, `file://${remote}`, clone])
  git(clone, 'switch', '-q', '-c', branch)
  return { remote, clone }
}

function decide(clone, branch = 'feature') {
  const result = spawnSync('sh', [skippableScript], {
    cwd: clone,
    env: { ...process.env, DRONE_BRANCH: branch },
    encoding: 'utf8',
  })
  // Git's own errors may precede the decision; the reason is the last line.
  return { decision: result.status === 0 ? 'skip' : 'run', reason: result.stderr.trim().split('\n').at(-1) }
}

test('a branch that changes only documentation skips the browser gate', async (t) => {
  const { clone } = await branchClone(t)
  await commitFiles(clone, ['docs/operations.md', 'research/notes.txt', 'README.md', 'client/README.md'])
  assert.deepEqual(decide(clone), {
    decision: 'skip',
    reason: 'BROWSER GATE SKIPPED: nothing outside documentation changed since main.',
  })
})

for (const path of ['client/src/main.ts', 'server/src/index.ts', 'Dockerfile', 'deploy/browser-check.sh', '.drone.yml', 'packages/domain/src/index.ts']) {
  test(`a branch that changes ${path} runs the browser gate`, async (t) => {
    const { clone } = await branchClone(t)
    await commitFiles(clone, ['docs/operations.md', path])
    assert.deepEqual(decide(clone), { decision: 'run', reason: `Browser gate runs: changes outside documentation, such as ${path}.` })
  })
}

test('moving a documentation file into the client runs the browser gate', async (t) => {
  const { clone } = await branchClone(t)
  git(clone, 'mv', 'docs/operations.md', 'client/src/operations.md.ts')
  git(clone, 'commit', '-q', '-m', 'Move')
  assert.equal(decide(clone).decision, 'run')
})

test('main always runs the browser gate, even for documentation', async (t) => {
  const { remote } = await branchClone(t)
  await commitFiles(remote, ['docs/operations.md'])
  assert.deepEqual(decide(remote, 'main'), { decision: 'run', reason: 'Browser gate runs: main always runs it.' })
})

test('main under a full ref name runs the browser gate, even for documentation', async (t) => {
  const { remote, clone } = await branchClone(t)
  await commitFiles(remote, ['docs/operations.md'])
  git(clone, 'switch', '-q', 'main')
  git(clone, 'pull', '-q', '--ff-only')
  assert.deepEqual(decide(clone, 'refs/heads/main'), { decision: 'run', reason: 'Browser gate runs: no commits beyond main.' })
})

test('a new branch with no commits beyond main runs the browser gate', async (t) => {
  const { clone } = await branchClone(t)
  assert.deepEqual(decide(clone), { decision: 'run', reason: 'Browser gate runs: no commits beyond main.' })
})

test('changes that reached main after the branch left it do not count', async (t) => {
  const { remote, clone } = await branchClone(t)
  await commitFiles(remote, ['client/src/main.ts'])
  await commitFiles(clone, ['docs/operations.md'])
  assert.equal(decide(clone).decision, 'skip')
})

test('a missing main branch runs the browser gate', async (t) => {
  const { remote, clone } = await branchClone(t)
  await commitFiles(clone, ['docs/operations.md'])
  git(remote, 'branch', '-q', '-m', 'main', 'trunk')
  assert.deepEqual(decide(clone), { decision: 'run', reason: 'Browser gate runs: could not fetch main.' })
})

test('a missing origin remote runs the browser gate', async (t) => {
  const { clone } = await branchClone(t)
  await commitFiles(clone, ['docs/operations.md'])
  git(clone, 'remote', 'remove', 'origin')
  assert.equal(decide(clone).decision, 'run')
})

test('a branch with no history in common with main runs the browser gate', async (t) => {
  const { clone } = await branchClone(t)
  git(clone, 'switch', '-q', '--orphan', 'feature-orphan')
  await commitFiles(clone, ['docs/operations.md'])
  assert.deepEqual(decide(clone, 'feature-orphan'), { decision: 'run', reason: 'Browser gate runs: no merge base with main.' })
})

test('a shallow clone runs the browser gate', async (t) => {
  const { clone } = await branchClone(t, { cloneArgs: ['--depth=1'] })
  await commitFiles(clone, ['docs/operations.md'])
  assert.deepEqual(decide(clone), { decision: 'run', reason: 'Browser gate runs: shallow or unreadable clone.' })
})

test('an unknown branch runs the browser gate', async (t) => {
  const { clone } = await branchClone(t)
  await commitFiles(clone, ['docs/operations.md'])
  assert.equal(decide(clone, '').decision, 'run')
})
