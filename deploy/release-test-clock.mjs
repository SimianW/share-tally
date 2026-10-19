// Preloaded by release.test.mjs into the release script, never in production.
// Replaces its clock so deadlines follow the stub Railway API, not how busy the
// test machine is. Time passes only while the script sleeps between polls, or
// when the stub reports a stalled request: the clock then jumps to that
// request's timeout. The elapsed time is written to a file on exit, only once
// the stream below is connected, so a missing file means the clock never ran.
import { writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { syncBuiltinESMExports } from 'node:module'
import timersPromises from 'node:timers/promises'

let now = 0
let latestTimeout = 0
const pending = new Set()

function advance(to) {
  now = Math.max(now, to)
  for (const timer of [...pending].sort((a, b) => a.at - b.at)) {
    if (timer.at > now) break
    pending.delete(timer)
    timer.fire()
  }
}

performance.now = () => now
AbortSignal.timeout = (milliseconds) => {
  const controller = new AbortController()
  latestTimeout = now + milliseconds
  pending.add({
    at: latestTimeout,
    fire: () => controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
  })
  return controller.signal
}
timersPromises.setTimeout = async (milliseconds, value) => {
  advance(now + milliseconds)
  return value
}
syncBuiltinESMExports()

// The stub writes to this stream when it stops answering a request. The script
// awaits one request at a time, so the latest timeout belongs to that request.
const stalls = await new Promise((resolve, reject) => {
  get(process.env.RELEASE_TEST_CLOCK_URL, resolve).on('error', reject)
})
stalls.socket.unref()
stalls.on('data', () => advance(latestTimeout))
process.on('exit', () => writeFileSync(process.env.RELEASE_TEST_CLOCK_FILE, String(now)))
