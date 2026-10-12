import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const deployScript = fileURLToPath(new URL('./deploy.sh', import.meta.url))
const token = 'test-project-token-must-never-be-logged'

async function releaseFixture(t, {
  apiStatuses = ['BUILDING', 'DEPLOYING', 'SUCCESS'],
  stallOperation,
  stallResponseBody = false,
  hostileResponse,
} = {}) {
  const remote = await mkdtemp(join(tmpdir(), 'share-tally-release-'))
  t.after(() => rm(remote, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', '--initial-branch=main', remote])
  execFileSync('git', ['-C', remote, '-c', 'user.name=Release test', '-c', 'user.email=release@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'Release'])
  const sha = execFileSync('git', ['-C', remote, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const images = new Map()
  const active = new Map()
  const deploymentServices = new Map()
  const violations = []
  const requests = []
  const redirectedTokens = []
  let webBeforeApiSuccess = false
  const statuses = { 'api-service': [...apiStatuses], 'web-service': ['DEPLOYING', 'SUCCESS'] }
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const { query, variables } = JSON.parse(body)
    requests.push({ query, variables })
    if (request.headers['project-access-token'] !== token || request.headers.authorization) {
      violations.push('Expected project token header, not bearer authentication')
    }
    if (stallOperation && query.includes(stallOperation)) {
      if (stallResponseBody) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.write('{"data":')
      }
      return
    }
    if (hostileResponse === 'redirect') {
      if (request.url === '/token-target') {
        redirectedTokens.push(request.headers['project-access-token'])
        response.writeHead(401).end(token)
      } else {
        response.writeHead(307, { location: '/token-target' }).end()
      }
      return
    }
    if (hostileResponse === 'http-error') {
      response.writeHead(401).end(`Unauthorized: ${token}`)
      return
    }
    if (hostileResponse === 'graphql-error') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ errors: [{ message: token }] }))
      return
    }
    if (hostileResponse === 'malformed-json') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(`Not JSON: ${token}`)
      return
    }
    let data
    if (query.includes('projectToken')) {
      data = { projectToken: { projectId: 'project-id', environmentId: 'production-environment' } }
    } else if (query.includes('serviceInstanceUpdate')) {
      const { serviceId, environmentId, input } = variables
      if (environmentId !== 'production-environment' || !statuses[serviceId]) violations.push('Incorrect service/environment')
      if (serviceId === 'web-service' && !active.has('api-service')) webBeforeApiSuccess = true
      images.set(serviceId, input.source.image)
      data = { serviceInstanceUpdate: true }
    } else if (query.includes('serviceInstanceDeployV2')) {
      const { serviceId, environmentId } = variables
      if (environmentId !== 'production-environment' || !images.has(serviceId)) violations.push('Deployment missing matching image update')
      const id = hostileResponse === 'deployment-id' ? `${serviceId}-${token}` : `${serviceId}-deployment`
      deploymentServices.set(id, serviceId)
      data = { serviceInstanceDeployV2: id }
    } else if (query.includes('deployment(')) {
      const serviceId = deploymentServices.get(variables.id)
      const sequence = statuses[serviceId]
      const status = sequence.length > 1 ? sequence.shift() : sequence[0]
      if (status === 'SUCCESS') active.set(serviceId, images.get(serviceId))
      data = { deployment: { id: variables.id, status } }
    } else {
      violations.push('Unexpected Railway operation')
      response.writeHead(400).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  })
  const env = {
    ...process.env,
    DRONE_COMMIT_SHA: sha,
    DRONE_REMOTE_URL: remote,
    RAILWAY_PROJECT_TOKEN: token,
    RAILWAY_PROJECT_ID: 'project-id',
    RAILWAY_ENVIRONMENT_ID: 'production-environment',
    RAILWAY_API_SERVICE_ID: 'api-service',
    RAILWAY_WEB_SERVICE_ID: 'web-service',
    RAILWAY_API_URL: `http://127.0.0.1:${server.address().port}/graphql/v2`,
    RAILWAY_POLL_INTERVAL_MS: '5',
    RAILWAY_REQUEST_TIMEOUT_MS: '500',
    RAILWAY_DEPLOYMENT_TIMEOUT_MS: '2000',
  }
  return {
    sha, env, images, active, violations, requests, redirectedTokens,
    get webBeforeApiSuccess() { return webBeforeApiSuccess },
    run(overrides = {}) {
      return new Promise((resolve, reject) => {
        const started = performance.now()
        const child = spawn('sh', [deployScript], { env: { ...env, ...overrides } })
        let output = ''
        child.stdout.on('data', (chunk) => { output += chunk })
        child.stderr.on('data', (chunk) => { output += chunk })
        const watchdog = setTimeout(() => child.kill('SIGKILL'), 5000)
        child.on('error', reject)
        child.on('close', (code, signal) => {
          clearTimeout(watchdog)
          resolve({ code, signal, output, duration: performance.now() - started })
        })
      })
    },
  }
}

test('deploys the commit-tagged API image and waits for it to become active', async (t) => {
  const release = await releaseFixture(t)
  const result = await release.run()
  assert.equal(result.code, 0, result.output)
  assert.deepEqual(release.violations, [])
  assert.equal(release.active.get('api-service'), `ghcr.io/simianw/share-tally-api:${release.sha}`)
})

test('activates the matching web image only after the API deployment succeeds', async (t) => {
  const release = await releaseFixture(t)
  const result = await release.run()
  assert.equal(result.code, 0, result.output)
  assert.equal(release.webBeforeApiSuccess, false)
  assert.deepEqual(release.violations, [])
  assert.equal(release.active.get('web-service'), `ghcr.io/simianw/share-tally-web:${release.sha}`)
})

test('a failed API deployment fails the release without changing web', async (t) => {
  const release = await releaseFixture(t, { apiStatuses: ['FAILED'] })
  const result = await release.run()
  assert.equal(result.code, 1, result.output)
  assert.equal(result.signal, null)
  assert.equal(release.images.has('web-service'), false)
})

test('an API deployment that stays queued times out without changing web', async (t) => {
  const release = await releaseFixture(t, { apiStatuses: ['QUEUED'] })
  const result = await release.run({ RAILWAY_DEPLOYMENT_TIMEOUT_MS: '100' })
  assert.equal(result.code, 1, result.output)
  assert.equal(result.signal, null)
  assert.equal(release.images.has('web-service'), false)
})

test('a Railway request that never answers times out and never deploys web', async (t) => {
  const release = await releaseFixture(t, { stallOperation: 'serviceInstanceUpdate' })
  const result = await release.run({ RAILWAY_REQUEST_TIMEOUT_MS: '50' })
  assert.equal(result.code, 1, result.output)
  assert.equal(result.signal, null)
  assert.equal(release.images.has('web-service'), false)
})

test('the API deployment deadline also bounds a stalled status request', async (t) => {
  const release = await releaseFixture(t, { stallOperation: 'deployment(' })
  const result = await release.run({ RAILWAY_REQUEST_TIMEOUT_MS: '4000', RAILWAY_DEPLOYMENT_TIMEOUT_MS: '100' })
  assert.equal(result.code, 1, result.output)
  assert.equal(result.signal, null)
  assert.ok(result.duration < 1500, `Release took ${result.duration}ms`)
  assert.equal(release.images.has('web-service'), false)
})

test('a superseded commit exits successfully without contacting Railway', async (t) => {
  const release = await releaseFixture(t)
  const result = await release.run({ DRONE_COMMIT_SHA: '0000000000000000000000000000000000000000' })
  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /Release superseded/)
  assert.deepEqual(release.requests, [])
})

for (const hostileResponse of ['http-error', 'graphql-error', 'malformed-json', 'deployment-id']) {
  test(`the token never appears in stdout or stderr when Railway echoes it in ${hostileResponse}`, async (t) => {
    const release = await releaseFixture(t, { hostileResponse })
    const result = await release.run()
    assert.equal(result.code, hostileResponse === 'deployment-id' ? 0 : 1)
    assert.equal(result.output.includes(token), false)
  })
}

test('an unknown deployment status echoing the token fails promptly without exposing it or deploying web', async (t) => {
  const release = await releaseFixture(t, { apiStatuses: [token] })
  const result = await release.run()
  assert.equal(result.code, 1)
  assert.equal(result.output.includes(token), false)
  assert.ok(result.duration < 1500, `Release took ${result.duration}ms`)
  assert.equal(release.images.has('web-service'), false)
})

test('a token scoped to a different project cannot change either service', async (t) => {
  const release = await releaseFixture(t)
  const result = await release.run({ RAILWAY_PROJECT_ID: 'wrong-project' })
  assert.equal(result.code, 1, result.output)
  assert.equal(release.images.size, 0)
})

test('missing web configuration fails before changing the API', async (t) => {
  const release = await releaseFixture(t)
  const result = await release.run({ RAILWAY_WEB_SERVICE_ID: '' })
  assert.equal(result.code, 1, result.output)
  assert.equal(release.images.size, 0)
})

test('an unbounded deployment timeout is rejected before contacting Railway', async (t) => {
  const release = await releaseFixture(t, { apiStatuses: ['QUEUED'] })
  const result = await release.run({ RAILWAY_DEPLOYMENT_TIMEOUT_MS: 'Infinity' })
  assert.equal(result.code, 1, result.output)
  assert.equal(result.signal, null)
  assert.deepEqual(release.requests, [])
})

test('the request timeout bounds a response body that never finishes', async (t) => {
  const release = await releaseFixture(t, { stallOperation: 'deployment(', stallResponseBody: true })
  const result = await release.run({ RAILWAY_REQUEST_TIMEOUT_MS: '50' })
  assert.equal(result.code, 1, result.output)
  assert.equal(result.signal, null)
  assert.ok(result.duration < 1500, `Release took ${result.duration}ms`)
  assert.equal(release.images.has('web-service'), false)
})

test('a token scoped to a different environment cannot change either service', async (t) => {
  const release = await releaseFixture(t)
  const result = await release.run({ RAILWAY_ENVIRONMENT_ID: 'wrong-environment' })
  assert.equal(result.code, 1, result.output)
  assert.equal(release.images.size, 0)
})

test('an HTTP redirect cannot forward the project token to another endpoint', async (t) => {
  const release = await releaseFixture(t, { hostileResponse: 'redirect' })
  const result = await release.run()
  assert.equal(result.code, 1, result.output)
  assert.equal(result.output.includes(token), false)
  assert.deepEqual(release.redirectedTokens, [])
})

test('API and web cannot target the same Railway service', async (t) => {
  const release = await releaseFixture(t)
  const result = await release.run({ RAILWAY_WEB_SERVICE_ID: 'api-service' })
  assert.equal(result.code, 1, result.output)
  assert.deepEqual(release.requests, [])
})

for (const status of ['CRASHED', 'REMOVED', 'REMOVING', 'SKIPPED']) {
  test(`an API deployment reporting ${status} fails without changing web`, async (t) => {
    const release = await releaseFixture(t, { apiStatuses: [status] })
    const result = await release.run()
    assert.equal(result.code, 1, result.output)
    assert.equal(release.images.has('web-service'), false)
  })
}
