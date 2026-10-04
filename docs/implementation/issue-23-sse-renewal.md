# Issue 23: overlapping SSE renewal

Implementation of [issue #23](https://github.com/SimianW/share-tally/issues/23), following [ADR-0018](../adr/0018-renew-sse-with-overlapping-connections.md).

## Connection ownership and handoff

An authenticated tab owns one synchronization session and one notification channel per group or member endpoint. Consumers share that channel but retain their own snapshot readers. A channel keeps at most one current connection and one candidate. Releasing the last consumer closes its streams and recovery work.

The server still ends streams at the earlier of verified JWT expiry and 30 seconds. Its `ready` event includes the deadline and remaining lifetime; the member event also retains its names version. A `renew` event arrives five seconds before the deadline. The replacement uses the same authenticated endpoint with a forced fresh Clerk token. Concurrent refreshes share an in-flight SDK request. The relative lifetime avoids relying on agreement between browser and server clocks.

A valid replacement `ready` immediately promotes the candidate and closes the old connection. REST reads do not delay that handoff. Candidate failure remains quiet while the current stream is healthy. Loss of the current subscription or failure of a required snapshot retains visible data and shows the existing stale notice. Attempts include token acquisition in their ten-second deadline; failures retry after 1, 2, 4, 8 and then at most 15 seconds. Late token completions cannot revive abandoned attempts.

Snapshot coordinators survive connection replacement. A newer invalidation cancels obsolete reads, prevents their state/cache writes and requests another authoritative snapshot. Healthy manual retry affects only the requesting reader. Hidden tabs close streams and cancel synchronization reads; foreground recovery subscribes before reading. Input preservation and server financial/conflict rules remain unchanged.

Expired credentials receive one fresh-token recovery before a 401 confirms authentication loss. Confirmed loss retires the session, cancels REST requests and clears protected queries. Delayed success and error bodies, including command-triggered cache refreshes, cannot restore data or retire a session after their request becomes obsolete. Group denial and deletion close the affected channels.

## Automated validation

Server tests use real Express requests and an isolated PostgreSQL database. Browser scenarios use the real React application, API and database with controlled Clerk identities and receipt providers. Chromium runs in a disposable Docker container. The nginx scenarios use the deployment config's API streaming directives; Vite supplies the test application instead of production static files.

The browser coverage includes shared/late consumers, handoff during held reads, independent snapshot failure, candidate failure, token acquisition failure/deadline, expired credentials, hidden/foreground transitions, deletion, authentication loss, obsolete command completion and actual API-process restart recovery. Existing group, bill, receipt and account-isolation scenarios also run.

On 2026-10-03, all 265 server tests, 55 client unit checks and 14 browser-environment/network-isolation checks passed. Server/client typechecks, ESLint, token/module-boundary checks and the production build passed. Both review axes, Standards and Spec, reported no outstanding consequential findings after their fixes.

The full groups/receipts run passed 58 of its original 59 scenarios. The 20-screen nginx scenario failed at initialization. Its final standalone run passed after changing test setup to load screens sequentially and reuse Vite static upstream connections. Vite serves thousands of development modules per page; its route now uses a keepalive upstream, optional HMR upgrade and original Host forwarding. The API streaming directives remain those from the deployment config. Three added authentication/restart regressions and the avatar scenario also passed, bringing coverage to all 63 current browser scenarios. These passes span the full run and focused follow-up runs, not one all-green aggregate invocation.

Restart recovery accommodates the existing 25-second liveness timeout: Vite can retain the downstream stream after its API upstream exits. The test verifies stale presentation with retained data, resubscription, current snapshots and no added financial records.

PR #211 review follow-ups add seven browser regressions, bringing the suite to 70 scenarios. A post-ready group REST 404 now preserves deletion navigation even when it arrives before the final SSE deletion frame. A denied members dialog disables its unavailable refresh action instead of entering permanent loading. Both regressions failed before their fixes and passed afterward; five related deletion, handoff and shared-renewal scenarios also passed. Manual retry coverage now waits for the new REST read before asserting that a healthy stream remains connected. Client unit checks, lint and build passed again. Bill-detail 404s also check their known group before the reader stops, covering uncached reads while avoiding a false group-deletion notice when the group still exists. The deleted-bill regression failed before the fix, then passed alongside the group-deletion and denied-bill cases; the existing-group 404 case passed too. The delayed-frame scenarios deliberately fragment network chunks and buffer complete SSE frames. A direct bill link with a failed group-list read also reproduced a retained deleted bill when no group metadata was cached. The bill now clears its local state and leaves its route on confirmed channel deletion, independently of the global named notice; this regression and five related deletion/denial scenarios passed after the fix. A stream 404 after the authorized bill lookup but before initial readiness also leaves the deleted route; snapshot 404s retain their distinct missing-bill behavior. The new-bill page hides its ineffective retry action after terminal access denial while retaining transient-failure recovery. Both additional regressions failed before their fixes and passed afterward, including stream and snapshot denial for the new-bill page. Five related cases, including draft refresh and transient retry, also passed.

## Local nginx measurements

Each measurement has 64 committed bill creations. Every screen rendered each bill; observed subscription gaps and interruption notices were zero. The single screen crossed two replacement boundaries during measurement, and every screen in the 20-screen run crossed three. At most two stream attempts were active per screen.

| Screens | p50 | p99 | Maximum | Subscription gaps | Interruption notices |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 75 ms | 141 ms | 141 ms | 0 | 0 |
| 20 | 1189 ms | 1710 ms | 1710 ms | 0 | 0 |

Latency runs from receipt of the successful API commit response to confirmation that all rendered views show the new bill. It includes REST snapshot reads, rendering and assertion polling; it is neither exact database-commit timing nor transport latency. Twenty independent browser contexts run inside one Chromium container, with Vite serving the application. The high 20-screen result is reported as measured; this run does not isolate its causes or establish production capacity.

Initial subscription timing, also including assertion polling and measurement overhead:

| Screens | Open stream to ready | Ready to first rendered snapshot | Open stream to first rendered snapshot |
| --- | ---: | ---: | ---: |
| 1 | 19 ms | 67 ms | 86 ms |
| 20, median per screen | 20 ms | 55 ms | 74 ms |

There is no reproduced old-client baseline. The previous temporary benchmark results are unavailable and use a different measurement boundary, so these figures cannot establish an equivalent before/after latency improvement. The observed evidence supports continuity through healthy overlapping handoffs and removal of false normal-renewal notices.

Real Clerk and the deployed public route, including FRP, remain unverified. Controlled identities do not prove token renewal or revocation behavior in Clerk. No production deployment is part of this change.

## Reproducing the checks

Run browser suites sequentially because they share Vite's dependency cache:

```sh
pnpm --dir server test
pnpm --dir server typecheck
pnpm --dir client test:unit
pnpm --dir client test:environment
pnpm --dir client test:network-isolation
pnpm --dir client test:groups
pnpm --dir client test:receipts
pnpm --dir client test:avatar
pnpm --dir client lint
pnpm --dir client build
```

For only the local nginx measurements:

```sh
pnpm --dir client test:browser sse-nginx-soak-one sse-nginx-soak-twenty
```

Raw reports are written to the ignored `client/test-results/sse-soak-1.json` and `sse-soak-20.json`. Each records its latency definition, raw samples, initial snapshot timing and per-screen connection statistics.
