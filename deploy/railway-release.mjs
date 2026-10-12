import { execFile } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const execute = promisify(execFile)

const tokenQuery = `query ReleaseTokenScope {
  projectToken { projectId environmentId }
}`
const updateMutation = `mutation UpdateReleaseImage($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
  serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
}`
const deployMutation = `mutation DeployReleaseImage($serviceId: String!, $environmentId: String!) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
}`
const deploymentQuery = `query ReleaseDeployment($id: String!) {
  deployment(id: $id) { id status }
}`
// Railway's first-party schema: deploymentCancel(id: String!): Boolean!.
// https://docs.railway.com/integrations/api/manage-deployments
const cancelMutation = `mutation CancelReleaseDeployment($id: String!) {
  deploymentCancel(id: $id)
}`

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function duration(name, fallback) {
  const value = Number(process.env[name] ?? fallback)
  // Node's timers use a signed 32-bit delay; larger values become 1ms.
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) {
    throw new Error(`Invalid ${name}`)
  }
  return value
}

async function main() {
  const sha = required('DRONE_COMMIT_SHA')
  const remote = required('DRONE_REMOTE_URL')
  // Drone serializes releases; an older queued commit must not replace main.
  // Capture Git's stderr too: URLs/errors may contain credentials.
  const { stdout } = await execute('git', ['ls-remote', '--', remote, 'refs/heads/main'], {
    timeout: 60000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  const mainSha = stdout.trim().split(/\s+/)[0]
  if (!mainSha) throw new Error('Could not read the head of main')
  if (mainSha !== sha) {
    console.log('Release superseded. Skipping Railway deployment.')
    return
  }
  const token = required('RAILWAY_PROJECT_TOKEN')
  const projectId = required('RAILWAY_PROJECT_ID')
  const environmentId = required('RAILWAY_ENVIRONMENT_ID')
  const apiServiceId = required('RAILWAY_API_SERVICE_ID')
  const webServiceId = required('RAILWAY_WEB_SERVICE_ID')
  if (apiServiceId === webServiceId) throw new Error('API and web must target different Railway services')
  const endpoint = process.env.RAILWAY_API_URL || 'https://backboard.railway.com/graphql/v2'
  const requestTimeout = duration('RAILWAY_REQUEST_TIMEOUT_MS', 30000)
  // 300s pre-deploy + 300s health check, with 300s for image pulls/setup.
  const deploymentTimeout = duration('RAILWAY_DEPLOYMENT_TIMEOUT_MS', 900000)
  const pollInterval = duration('RAILWAY_POLL_INTERVAL_MS', 2000)
  console.log(`Railway deployment deadline: ${deploymentTimeout / 1000}s per service.`)

  async function request(query, variables, deadline = Infinity) {
    const remaining = Math.ceil(deadline - performance.now())
    if (remaining <= 0) throw new Error('Railway deployment timed out')
    const timeout = Math.min(requestTimeout, remaining)
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'Project-Access-Token': token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeout),
    })
    if (!response.ok) throw new Error('Railway API request failed')
    const payload = await response.json()
    if (payload.errors?.length) throw new Error('Railway API rejected the request')
    // Keep a received deployment ID if local processing crosses the deadline:
    // the caller can cancel it, or accept an authoritative SUCCESS status.
    return payload.data
  }

  async function deploy(serviceId, image) {
    const deadline = performance.now() + deploymentTimeout
    const variables = { serviceId, environmentId }
    const updated = await request(updateMutation, {
      ...variables,
      input: { source: { image } },
    }, deadline)
    if (updated?.serviceInstanceUpdate !== true) throw new Error('Railway image update failed')
    const deployment = await request(deployMutation, variables, deadline)
    const id = deployment?.serviceInstanceDeployV2
    if (typeof id !== 'string' || !id) throw new Error('Railway did not return a deployment ID')
    let terminalFailure = false
    try {
      while (true) {
        if (performance.now() >= deadline) throw new Error('Railway deployment timed out')
        const state = await request(deploymentQuery, { id }, deadline)
        if (state?.deployment?.status === 'SUCCESS') return
        if (['FAILED', 'CRASHED', 'REMOVED', 'REMOVING', 'SKIPPED'].includes(state?.deployment?.status)) {
          terminalFailure = true
          throw new Error('Railway deployment failed')
        }
        if (!['INITIALIZING', 'BUILDING', 'DEPLOYING', 'QUEUED', 'WAITING', 'NEEDS_APPROVAL', 'SLEEPING'].includes(state?.deployment?.status)) {
          throw new Error('Railway returned an unknown deployment status')
        }
        await delay(Math.min(pollInterval, Math.max(0, deadline - performance.now())))
      }
    } catch (error) {
      if (!terminalFailure) {
        // Cleanup needs its own request budget, not the expired deployment deadline.
        try {
          const cancelled = await request(cancelMutation, { id })
          if (cancelled?.deploymentCancel !== true) throw new Error('Railway cancellation rejected')
        } catch {
          // The API may reject cancellation if activation raced the failed poll.
          // Never print API errors or IDs: either could contain the project token.
          console.error('Railway deployment cancellation failed; deployment may still activate.')
        }
      }
      throw error
    }
  }
  const scope = await request(tokenQuery, {})
  if (scope?.projectToken?.projectId !== projectId || scope?.projectToken?.environmentId !== environmentId) {
    throw new Error('Railway token scope does not match the configured project/environment')
  }
  await deploy(apiServiceId, `ghcr.io/simianw/share-tally-api:${sha}`)
  console.log('API deployment succeeded.')
  await deploy(webServiceId, `ghcr.io/simianw/share-tally-web:${sha}`)
  console.log('Web deployment succeeded.')
}

main().catch(() => {
  // API responses and runtime errors may include the token. Never print them.
  console.error('Railway release failed.')
  process.exitCode = 1
})
