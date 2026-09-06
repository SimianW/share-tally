# ShareTally project discussion

Archived planning record. This file preserves the conversation through Q35, including proposals later superseded. It is not the current specification and should not be updated with new decisions. Use the [documentation index](../../docs/README.md) for current sources.

Recorded September 6, 2026. This is an organized record of the planning conversation, not a verbatim transcript or a finished implementation specification. No external market research was performed. Recommendations remain proposals unless explicitly accepted below.

## Current decision summary

This summary incorporates the resumed interview and supersedes older unanswered questions below. The earlier sections retain the planning history.

- Stack: TypeScript, Node.js, Express, PostgreSQL, Drizzle ORM with Drizzle Kit for migrations, and a React/Vite/TypeScript frontend are accepted. Google sign-in is accepted; the managed authentication service remains undecided. Hosting uses the owner's existing server/VPS and FRP setup. The owner writes the schema, reviews generated SQL migrations, and owns queries and transaction boundaries.
- Every selected participant, including the initiator, must explicitly submit their own share. Zero is valid; missing is not zero. The initiator cannot edit another participant's share.
- Bills complete automatically when all required submissions exist and the shares equal the total. There is no initiator-only close action.
- Any initiator edit reopens a bill and retains previous amounts. Every participant must reconfirm, even if their amount is unchanged.
- Changes to an existing participant share clear everyone's confirmations while retaining amounts. Once a bill is complete, participants must ask its initiator to reopen it before editing. A participant's first submission on a new bill preserves earlier participants' confirmations.
- Incomplete bills block settlement until completed or explicitly canceled by their initiators. Canceled records remain visible.
- Group-wide debt netting is accepted, without requiring the mathematically smallest number of transfers.
- Settlement starts through a member action. Once started, it cannot be canceled or reversed, even before any payment is confirmed. Bill reopening and changes must wait until settlement finishes; included bills then remain archived or paid history.
- Recipients confirm individual repayments made outside the app, once the full instructed amount has arrived. Partial payments are not tracked, though members may send multiple payments externally. A confirmation dialog shows sender, recipient, and amount. Settlement finishes when the required repayments are confirmed.
- Settlement includes all complete, unsettled bills in the group regardless of month or amount. Previously settled and canceled bills are excluded; incomplete bills block settlement.
- Only the affected group blocks new bills, bill edits, and membership changes during settlement. Viewing and payment confirmations remain available.
- If every member's net balance is zero, settlement finishes immediately. This means no member owes or is owed money, rather than merely that the sum of all balances is zero.
- Settled bills cannot be edited or corrected. Linked corrections are outside the accepted scope.
- CAD is the only currency. Bill totals must be positive; participant shares must be nonnegative; amounts have at most two decimal places. Participants include taxes and discounts in their shares and resolve rounding themselves. Shares must sum exactly to the bill total.
- Users join groups through invitation links. Leaving groups, removing group members, and deleting groups are deferred.
- Only the group creator can access the invitation link through the app or regenerate it. Regeneration invalidates the old link. Anyone holding the current link can join after signing in, except during settlement. This permission cannot prevent a link recipient from forwarding a link they already possess.
- Every group member can view all group bills, participant shares, and settlement progress, including bills they did not participate in.
- Only the bill initiator can remove someone from that bill's participant list. This is separate from removing a member from the group, which is deferred.
- Receipt images are unnecessary for the manual first release.
- The first release operates through the web UI, with an in-app "Needs your attention" list for outstanding shares, reconfirmations, and incoming repayments to confirm. Email, push, and other external notifications are outside scope.
- Google is the first-release sign-in method. Sign-in should persist on the same browser/device for at least a month without routine login prompts. The managed authentication service will be chosen later; session persistence remains subject to explicit sign-out, cleared browser storage, and session revocation.
- The owner will host the website on their existing server, exposed through a public-IP VPS and FRP. Exact routing, domain, HTTPS termination, application/database placement, and backup arrangements have not been inspected or selected. Do not infer the deployment host is the current development environment.
- Release acceptance requires a deployed app where the owner and at least two friends complete a real purchase through share submission, reopening, reconfirmation, settlement, and repayment confirmation. Automated checks must cover permissions, exact balances, simultaneous edits, duplicate requests, and settlement restrictions before the trial.
- The owner retains responsibility for schema, migrations, business rules, and core workflows. Manual operation comes first; AI extraction remains optional.

The glossary is in `CONTEXT.md`. Accepted decisions with material tradeoffs are recorded in `docs/adr/0001-participants-own-their-bill-shares.md` and `docs/adr/0002-settlement-cannot-be-reversed.md`.

### Engineering skill setup

The owner selected GitHub Issues for `SimianW/share-tally`, the five default triage labels, and `AGENTS.md` as the instruction file. The repository uses a single-context domain layout. A four-file setup draft was shown during the conversation. On the latest repository inspection, `AGENTS.md` and the three `docs/agents/` configuration files are present.

## Purpose and context

The owner wants a project that improves their competitiveness for backend and full-stack co-op roles and provides backend code they personally understand and can defend in interviews.

Their largest current project, DevRecall, was described as approximately 95% AI-generated. The initial aspiration for this project was about 50% AI assistance, with the owner implementing the core business and system logic. The discussion reframed ownership around being able to explain, modify, test, and debug the code, rather than counting generated lines.

Backend/full-stack roles are the priority. Applied AI is a possible secondary strength. Training machine learning models is not the focus of this project.

The conversation began in `/home/simon/Dev/MyResume`. ShareTally now has its own workspace at `/home/simon/Dev/share-tally` so planning and implementation can continue separately.

## Time budget

- Target delivery: three to four weeks.
- Typical commitment: roughly five hours per week, potentially five to seven hours overall with extra time early in the semester.
- Maximum budget: 30 hours.
- Planning recommendation, not an additional user commitment: scope the first release around 20 hours and reserve the remaining time for problems, testing, and deployment.

## How the idea evolved

The original idea was an expense tracker with a spending dashboard, receipt photo analysis, extracted line items, a second AI categorization call, and backend storage of receipts and images per user. Potential AI approaches initially included trained models, embeddings, or major providers' APIs.

The assistant suggested a receipt and reimbursement system for a club or small team because approvals, permissions, budgets, corrections, and audit records would create substantive backend work. Those club reimbursement features were suggestions, not accepted requirements.

The owner identified a real use case: friends frequently make bulk purchases together at Costco and other large stores, then need to split costs and repay each other. The product became a shared-expense app for that group.

The initial shared-expense proposal included groups, posted bills, participant amounts, automatic month-end debt cancellation, and instructions showing whom each member should repay. Subsequent discussion replaced automatic month-end processing with a member-triggered settlement action.

## Name and positioning

The owner selected **ShareTally**.

The owner subsequently specified kebab-case for the directory and GitHub repository: **`share-tally`**. The product name remains ShareTally.

Suggested repository description:

> A shared-expense app where groups submit bills, confirm individual shares, and settle balances with fewer repayments.

Suggested future resume heading, once implemented:

> ShareTally — Collaborative Expense Splitting App

Other names considered were CartShare, TabTogether, SplitLedger, SettleCircle, and OurTab. Product-name and domain availability were not checked. The name should support shared purchases beyond Costco and beyond monthly accounting.

## Confirmed product direction

### Groups and bill participation

- Users can form groups and post bills to a group.
- The person who paid for a purchase initiates the bill, supplies its total, and identifies the people involved.
- Each participant, including the initiator, enters their own share on that bill.
- The initiator cannot change another participant's share.
- A bill becomes complete when the required participant amounts add up correctly to the total.
- Exact handling of missing submissions versus an explicitly submitted zero remains open.

The assistant originally recommended that the purchase payer enter everyone's final amounts to reduce scope. The owner instead chose participant-entered amounts. Do not revert to payer-entered allocations without revisiting this decision.

The conversation moved toward participant totals rather than individual receipt-item claiming, but detailed handling of taxes, discounts, shared items, and rounding was not finalized. No item-level workflow is approved yet.

### Changes to bills

- If the initiator changes the financial record, it reverts to incomplete.
- An incomplete bill does not contribute to the monthly summary.
- It can become complete again when participant amounts satisfy the total.
- The initiator still cannot edit other participants' amounts.

The assistant's earlier proposal to prohibit edits and use void-and-replace corrections was not the chosen workflow. The owner chose reopening instead.

Whether reopening also requires every participant to explicitly reconfirm was asked but not answered. The exact distinction between financial changes and descriptive edits also remains open.

### Debt netting

The owner accepted group-wide netting. For example, if Alice owes Bob $20 and Bob owes Carol $20, the app may instruct Alice to pay Carol $20 directly.

The accepted direction is to derive member net balances and produce valid repayment instructions. There is no requirement to find the mathematically smallest possible number of transfers.

### Settlement and payment confirmation

- A member triggers "Calculate settlement" instead of relying on an automatic month-end job.
- The owner wants the app to enter a restricted state until the settlement is cleared.
- Recipients confirm individual incoming payments on their own pages.
- Settlement clears once the required repayments are confirmed.

The owner's phrase "users cannot perform any actions" needs refinement because payment confirmation must remain possible. Whether the restriction applies only to that group, which actions are blocked, and how a stalled settlement can be recovered are unresolved.

No bank integration or automated money movement has been requested. The proposed flow records confirmation of repayments made outside the app.

### AI scope

- AI extraction is optional and can be omitted if time runs out.
- A usable manual workflow should come first.
- The assistant proposed later extracting merchant, date, and total as suggestions requiring human confirmation.
- The assistant recommended omitting a separate categorization call because it adds little to shared-debt settlement.
- No AI provider, model, extraction schema, or processing architecture has been selected.

## Implementation ownership

The owner agreed to personally write the database schema, migrations, business rules, processing workflows, and core tasks.

Their stated workflow:

- Think through small logic and attempt implementation before asking AI for help.
- Ask AI for assistance with bugs or problems they cannot handle.
- Use AI for boilerplate and non-core code to fit the delivery budget.
- Rely on AI for high-level architecture and system-design help.

The assistant recommended writing a short architecture proposal independently before asking AI to critique it, so architectural decisions also become part of the learning. That adjustment has not yet been explicitly accepted.

An earlier recommendation also placed core tests under the owner's responsibility. Specific testing tools and the test plan remain undecided.

## Stack discussion

The owner reports limited understanding of Spring Boot and some familiarity with FastAPI. They asked whether to deepen TypeScript or learn another stack.

The assistant recommended **TypeScript, Node.js, Express, and PostgreSQL**, with a familiar frontend and a single backend application. This stack has not yet been accepted by the owner.

Reasons given:

- One language across frontend and backend reduces the learning burden within 20–30 hours.
- Express has relatively little framework machinery, while requiring explicit organization of routes, validation, and database access.
- PostgreSQL supports learning relational constraints and transactions.
- Runtime request validation is still necessary; TypeScript's checks do not validate external input.
- The learning goal is a reliable backend the owner can explain, not complete mastery of TypeScript within a month.

FastAPI/Python and Spring Boot/Java remain alternatives. Database tooling, frontend framework, authentication, deployment, and hosting have not been selected.

## Resume context reviewed during the discussion

A read-only exploration of the resume workspace found existing evidence of:

- Spring Boot/MySQL and LLM integration in Molion, with individual backend responsibilities not fully established in prior notes.
- Retrieval, embeddings, fallback behavior, and tests in DevRecall.
- Next.js/FastAPI and model integration in the Mushroom Classifier.
- Hosting and deployment experience.

The assistant therefore recommended emphasizing relational modeling, transactions, multi-user authorization, and business-rule correctness. These were gaps in what the resume clearly demonstrated, not conclusions about the owner's competence.

Local source files from that exploration:

- `/home/simon/Dev/MyResume/base-resume/resume.tex`
- `/home/simon/Dev/MyResume/research/resume-strategy-winter-2027.md`

Earlier resume strategy considered evaluating existing projects instead of starting another. The owner's explicit learning and ownership goal motivated this separate project. No resume changes were requested as part of ShareTally setup.

## Open questions from the latest interview round

The owner paused the interview to name the project and establish this repository. The following questions were asked but not answered. Resume here without treating the recommendations as decisions.

### Q11: Commit to a stack?

Recommendation: TypeScript, Express, PostgreSQL, a familiar frontend, and one backend application. Choose database tooling after the product rules are settled.

### Q12: Must everyone explicitly submit, even if the amounts balance?

Example: a $100 bill includes Alice, Bob, and Carol. Alice submits $40 and Bob submits $60, while Carol submits nothing.

Recommendation: require a submission from every selected participant. An explicit zero is valid; a missing submission is not zero.

The assistant also suggested distinguishing the person who paid the store from participants declaring their shares, since "payer" becomes ambiguous during repayment. Final terminology was not settled.

### Q13: What must happen after a complete bill changes?

Recommendation: changes to the total, participants, or anyone's share reopen the bill and require everyone to reconfirm. Retain earlier amounts to make reconfirmation quick. Descriptive-note changes need not reopen the bill.

Alternative requiring a decision: completion depends only on submitted amounts balancing, without renewed confirmation from everyone.

### Q14: What happens to incomplete bills when settlement starts?

Recommendation: block settlement until incomplete bills are completed or explicitly canceled by their initiators. Show the blockers and retain canceled records visibly.

This recommendation has not been accepted. The confirmed rule excluding incomplete bills from a monthly summary does not resolve whether settlement must wait for them.

### Q15: How strict is the freeze, and how can the group recover?

Proposed first-release rules:

- Freeze expense creation and changes within the affected group during settlement.
- Continue allowing views and recipient payment confirmations.
- Save settlement transfers so they do not change while payments are being confirmed.
- Let the member who started settlement cancel it before any payment is confirmed.
- Once confirmations begin, finish settlement before reopening expenses.
- Preserve confirmed repayments and account for them in future balances.
- Immediately finish settlements requiring no transfers.

The owner has not accepted these details. They imply a delayed confirmation can block new bills. Recovery from mistakes, unconfirmed real payments, and stalled settlements needs further discussion.

## Further decisions still to explore

The interview is not complete. Depending on the answers above, future questions should cover:

- Currency scope, amount precision, validation, and rounding.
- Group creation, invitations, membership changes, and authorization.
- Whether participants may decline a bill or leave before entering a share.
- Permissions for changing totals and participant lists or canceling a bill.
- Safe handling of simultaneous submissions, edits, and settlement requests.
- Avoiding duplicate records from repeated requests and retries.
- Which expenses and repayments each settlement includes, and how to avoid counting them twice.
- Corrections to mistaken payment confirmations.
- Whether receipt images belong in the manual first release and how to store/access them.
- A small test plan centered on financial and authorization guarantees.
- Deployment and a trial with the owner's friends.
- An implementation sequence that fits the budget and preserves ownership.

These are unresolved planning topics, not a feature checklist that must all be implemented.

## Handoff

The owner explicitly paused design to create the ShareTally repository. Continue the planning interview from Q11–Q15 when they are ready. Do not assume the proposed stack or unanswered settlement rules are approved. No application implementation has been requested yet.

## Continued discussion: answers to Q11–Q14

These answers supersede the earlier open questions and handoff where they conflict. Q15 remains unanswered.

- **Q11:** The owner accepted TypeScript, Node.js, Express, and PostgreSQL. Specific frontend and database tooling remain undecided.
- **Q12:** Every selected participant must explicitly submit a share. Zero is valid; a missing submission is not zero. The person who paid for the purchase and created the bill is the initiator. Everyone selected, including the initiator, is a participant.
- **Q13:** Any initiator change to a bill reopens it, with previous amounts retained. Participants who need to change their amounts do so. Completion is automatic once the required submissions and total are satisfied; the initiator does not manually close the bill. Whether unchanged shares require a fresh confirmation after reopening still needs clarification. The owner wants the initiator to be able to reopen bills before final group settlement, and bills covered by a completed settlement to become archived or paid. The final status term and whether reopening is allowed during an active settlement remain unresolved.
- **Q14:** Incomplete bills block settlement. The owner accepted the recommendation to complete them or have their initiators explicitly cancel them before settlement starts, retaining canceled records visibly.
- **Q15:** The owner requested an explanation of "freeze" before deciding. The scope of restrictions and recovery rules are still proposals.

No application implementation has been requested. Later Q15–Q35 decisions are captured in the current decision summary and ADRs. Product and stack decisions are ready for a consolidated review. Remaining technical planning includes the managed authentication service, deployment topology, transaction/concurrency design, test tooling, and implementation sequence within the owner's time budget.

## Continued discussion: answers to Q16–Q22

- **Q16:** Everyone must reconfirm after reopening, including participants with unchanged shares.
- **Q17:** Settlement covers the group's bills without month or amount filtering, subject to the accepted incomplete-bill blocker and exclusion of settled/canceled history. It blocks new bills, edits, and membership changes in that group only. No-repayment settlements finish immediately when every member's individual net balance is zero.
- **Q18:** Corrections to settled bills are unsupported.
- **Q19:** CAD only. The answer did not explicitly settle amount precision, negative values, taxes, or rounding.
- **Q20:** Invitation links support joining. Leaving, removing group members, and deleting groups are deferred; the owner's phrase "join and leave using the invitation link" is read in light of their explicit decision to defer leaving.
- **Q21:** A mistakenly included participant asks the initiator to remove them from the bill. Only the initiator has this permission.
- **Q22:** Receipt images are not required.

## Continued discussion: answers to Q23–Q28

- **Q23:** Accepted positive bill totals, nonnegative participant shares, at most two decimal places, participant-calculated taxes/discounts/rounding, and an exact total match.
- **Q24:** Accepted one recipient confirmation for the full repayment amount and a confirmation dialog showing sender, recipient, and amount. No partial-payment tracking.
- **Q25:** All group members can view all group bills, shares, and settlement progress.
- **Q26:** Only the group creator can copy the invitation link through the app or regenerate it. Accepted signed-in joining through the current link outside settlement and invalidation of the old link after regeneration.
- **Q27:** Accepted clearing all confirmations when an existing share changes and requiring the initiator to reopen a completed bill before a participant edits. The word "competitors" in the answer refers to participants. Initial submission behavior still needs clarification to avoid silently making earlier participants reconfirm after every new submission.
- **Q28:** Accepted managed sign-in and deferred provider selection. The owner wants a smooth experience with a login lasting at least a month, rather than signing in on every visit.

## Continued discussion: answer to Q29

The owner accepted preserving earlier confirmations when another participant submits their share for the first time on a new bill. For example, Alice submits and confirms $40, then Bob submits and confirms $60 on a new $100 bill; Alice's confirmation remains valid and the bill completes automatically.

This does not change reopening: the initiator reopens a completed bill, amounts remain, and everyone's confirmations are cleared. An open bill can already balance financially while it waits for renewed confirmations. Confirming an unchanged amount does not invalidate anyone else's confirmation.

Q30–Q32 were subsequently accepted, as recorded below.

## Continued discussion: answers to Q30–Q32

- **Q30:** Accepted web-only operation and in-app attention tracking. No notifications outside the app in the first release.
- **Q31:** Accepted React, Vite, and TypeScript, with a layout designed for phone screens first.
- **Q32:** After discussing `pg`, Kysely, Drizzle, and Prisma, the owner accepted the recommendation of Drizzle ORM with Drizzle Kit for migrations. The preference is for higher-level TypeScript tooling while retaining ownership of relational modeling and business rules. `pg` may serve as the underlying PostgreSQL driver; driver selection remains an implementation detail to settle with hosting.

## Continued discussion: answers to Q33–Q35

- **Q33:** Accepted Google sign-in for the first release. Selecting the managed authentication service remains a separate technical decision, constrained by the month-long session requirement.
- **Q34:** The owner will host on their existing server, using a VPS with a public IP and FRP to expose it. This replaces the suggested new free hosting plans. The precise network topology and any budget for additional services remain unspecified.
- **Q35:** Accepted the proposed release target: the owner and at least two friends exercise the deployed workflow on a real shared purchase, with automated tests for financial correctness, authorization, concurrency, retries, and settlement restrictions beforehand.
