# J-Bot Code Review

This workflow copies the currently deployed DevRecall review configuration: GLM-5.3 through the mainland BigModel Coding Plan endpoint, one review pass, one shard/session at a time, finding verification and guideline review enabled, P0-P2 findings capped at ten, documentation reviews enabled, and no automatic approval.

## Credentials and variables

Add repository Actions secret `ZAI_API_KEY`. Never put its value in files, PRs, or chat. GitHub provides `GITHUB_TOKEN` automatically.

Optional Actions variables:

- `JBOT_GLM_MODEL`: bare model ID; default `glm-5.3`.
- `JBOT_GLM_BASE_URL`: default `https://open.bigmodel.cn/api/coding/paas/v4`. International Z.AI accounts must use `https://api.z.ai/api/coding/paas/v4` instead.

## Triggers

Open, reopen, mark ready, or push a new commit to a non-draft same-repository PR. Fork, closed, draft, and Dependabot PRs are skipped. Superseded automatic events are skipped.

After this workflow is merged into the default branch, comment exactly `/jbot` or use Actions → J-Bot Code Review → Run workflow and enter an open PR number. Comment commands require current write/maintain/admin repository permission. Flags are not supported. One accepted review per PR runs at a time; a newer run cancels the older one.

## Results and scope

Read the PR review as well as the Actions status. A completed workflow means review completed, not that code is bug-free. Failures in credentials, provider calls, or posting fail the workflow. Adding a secret does not itself start a run; rerun failed jobs after correcting credentials.

The model receives the diff and requested repository context. REVIEW.md adds ShareTally-specific guidance and points to existing domain documents. J-Bot cannot push code or approve/merge PRs. It does not run the application test suite or deploy the app; this repository currently has no separate CI workflow.

The setup PR can validate credentials and review posting before merge. This is an integration test, not a benchmark of bug-finding quality. Comment and manual triggers require default-branch installation.

Checkout and github-script use the same pinned SHAs as DevRecall. J-Bot's upstream `slim@v0` action uses a floating Docker image; pinning only its action SHA would not freeze the runtime. This setup retains the same upstream-update behavior as DevRecall. Extra permissions for thread resolution are not configured; addressed-thread resolution can be limited by GitHub's token permissions.

The gate has a five-minute timeout, the review job a forty-minute timeout, and the reviewer a thirty-minute target budget. The action may pull its Docker image before executing the credential check.
