# J-Bot Code Review

This workflow is based on the DevRecall review configuration: GLM-5.3-Flash through the mainland BigModel Coding Plan endpoint, one review pass, one main-review shard and up to three concurrent model sessions, finding verification and guideline review enabled, P0-P3 findings capped at ten, documentation reviews enabled, and no automatic approval.

## Credentials and variables

Add repository Actions secret `ZAI_API_KEY`. Never put its value in files, PRs, or chat. GitHub provides `GITHUB_TOKEN` automatically.

Optional Actions variables:

- `JBOT_GLM_MODEL`: bare model ID; default `glm-5.3-flash`.
- `JBOT_GLM_BASE_URL`: default `https://open.bigmodel.cn/api/coding/paas/v4`. International Z.AI accounts must use `https://api.z.ai/api/coding/paas/v4` instead.

## Triggers

Open, reopen, mark ready, or push a new commit to a non-draft same-repository PR. Fork, closed, draft, and Dependabot PRs are skipped. Superseded automatic events are skipped.

After this workflow is merged into the default branch, comment exactly `/jbot` or use Actions → J-Bot Code Review → Run workflow and enter an open PR number. Comment commands require current write/maintain/admin repository permission. Flags are not supported. One accepted review per PR runs at a time; a newer run cancels the older one.

## Results and scope

Read the PR review as well as the Actions status. A completed workflow means review completed, not that code is bug-free. Failures in credentials, provider calls, or posting fail the workflow. Adding a secret does not itself start a run; rerun failed jobs after correcting credentials.

The model receives the diff and requested repository context. The repository no longer supplies a separate REVIEW.md override. Project context is documented in [AGENTS.md](../AGENTS.md), with terminology in [CONTEXT.md](../CONTEXT.md) and accepted decisions in [docs/adr](adr/). J-Bot cannot push code or approve/merge PRs. It does not run the application test suite or deploy the app; the separate Drone pipeline runs tests and builds on pushes, and deploys main-branch pushes.

The setup PR can validate credentials and review posting before merge. This is an integration test, not a benchmark of bug-finding quality. Comment and manual triggers require default-branch installation.

Checkout and github-script use the same pinned SHAs as DevRecall. J-Bot's upstream `slim@v0` action uses a floating Docker image; pinning only its action SHA would not freeze the runtime. This setup retains the same upstream-update behavior as DevRecall. Extra permissions for thread resolution are not configured; addressed-thread resolution can be limited by GitHub's token permissions.

The gate has a five-minute timeout, the review job a forty-minute timeout, and the reviewer a thirty-minute target budget. The action may pull its Docker image before executing the credential check.

The three-session limit lets the main review and auxiliary checks run concurrently when the provider supports it. It does not split the main review into multiple shards.

The upstream action has no separate guideline-check timeout input. Its current timeout implementation gives auxiliary checks a ten-minute runway from launch, or five minutes after the main review finishes, whichever ends later, capped by the remaining overall budget and reserves for verification and posting. Queueing can consume that runway, so allowing concurrent sessions avoids the previous one-session bottleneck. This is not a guaranteed ten minutes of provider execution or an extra ten minutes after the main review. The thirty-minute target budget remains unchanged. See the [upstream timeout implementation](https://github.com/pgup-ai/jbot-review/blob/main/src/shared/time-budget.ts).
