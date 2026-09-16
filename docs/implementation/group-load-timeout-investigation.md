# Group load timeout investigation

On 2026-09-16, the browser suite timed out at `smoke-navigation.mjs:114`, waiting for "Couldn't load this group." after intercepting a fresh group's bill read with HTTP 503.

## Finding

The failed run had an empty page and 1,012 Chromium `net::ERR_NETWORK_CHANGED` console errors. This was not evidence that the application's 503 error handling failed. Frontend JavaScript resources failed to load, so React never rendered the expected message.

A controlled reproduction started a second disposable PostgreSQL container while reloading the same page. It reproduced the original assertion failure on the first attempt, with 646 failed network-change requests and an empty `#root`. Failed requests included Vite JavaScript dependencies. Container startup changes host network interfaces; Chromium can invalidate in-flight requests in response. The experiment proves this mechanism can cause the observed failure, but does not identify which external process changed the network during the original run.

The control scenario loaded a group, intercepted its bill read with 503 and reloaded the page ten times without concurrent container startup. All ten displayed the expected error. Running the original full `pnpm test:groups` suite separately also passed, including initial failure, recovery, revoked access and account isolation.

## Changes and operation

The browser harness now aggregates failed resource paths for `ERR_NETWORK_CHANGED` and explains the infrastructure failure when an assertion fails. It excludes authorization headers and query strings and avoids flooding the log with hundreds of duplicate console errors. It preserves the original assertions and exit status.

No application error handling, retry policy, five-second assertion timeout or financial behavior was changed. Run local browser smoke separately from jobs that create or stop Docker containers. Shared-host jobs outside this repository can still interfere; stronger isolation requires a stable network namespace for the browser and application. This investigation does not prove real-user network transitions or production recovery.

Temporary reproduction scripts and browser-switch experiments were removed. No production deployment was performed.
