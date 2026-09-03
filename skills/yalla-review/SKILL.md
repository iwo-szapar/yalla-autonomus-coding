---
name: yalla-review
description: >
  Adversarial code review with binary pass/fail checks. Each reviewer answers
  one specific question about the code. Any Fail blocks shipping.
  Use standalone for reviewing changes, or invoked by /yalla and /yalla-team.
  Do NOT use when changes haven't been tested yet (run tests first).
argument_hint: "[optional: specific files or diff to review]"
---

# /yalla-review

Binary pass/fail code review. Each reviewer checks one specific aspect. No severity scales — either the code passes the check or it doesn't. The default comparison base is `$BASE_BRANCH` (from `base_branch:` in `.claude/YALLA.md`, default `main`).

## Core Principle

Each reviewer answers ONE specific question with Pass or Fail. Not "rate the quality" — that produces unactionable noise. Binary forces explicit definitions of what constitutes failure, making disagreements resolvable and fixes obvious.

Risk gates are triggered by the changed files and workflow. Do not run every historical check on every PR. The universal checks stay small; subsystem checks run only when their trigger applies.

For non-trivial work, include the operator-understanding layer (see `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/`). This check verifies that the operator/maintainer can understand the change without reading code; it does not quiz the operator or grade writing polish.

---

## Step 1: Get Changed Files

```bash
git diff "$BASE_BRANCH" --name-only
git diff "$BASE_BRANCH"
```

Also read `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/ARTIFACTS.md`, `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/EVIDENCE-GATES.md`, `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/TEST-SEAMS.md`, `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/ARCHITECTURE-DEPTH.md`, `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/PROJECT-CHECKS.md`, `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/REVIEW-CHECKS.md`, and `${CLAUDE_PLUGIN_ROOT}/knowledge/product/INTENDED-VS-IMPLEMENTED.md` before launching reviewers.

## Step 2: Launch Reviewers

### Always run:

**security-check:**
> "Does this change introduce SQL injection, XSS, SSRF, auth bypass, exposed secrets, or missing input validation?"

Specifics to check:
- String interpolation in SQL (use parameterized queries)
- Unsafe HTML rendering with user input (innerHTML or framework unsafe props)
- API endpoints without auth verification
- Secrets/keys in code (provider key prefixes, tokens)
- Webhook handlers without signature verification
- **Token/identity binding:** any token granting access (invite tokens, signup tokens, API tokens) must be bound to the identity it was issued for (email, account_id) and that binding verified on use. A leaked token must not allow the holder to assume a different identity.
- **Lifecycle cascade revocation:** when a parent record is suspended, deleted, or expired (account, user, session), all dependent grants (tokens, sessions, API keys) must be revoked in the same transaction. Defence-in-depth: validators should also check parent status, not just `is_active`.
- **Error-response leakage to unauth callers:** validation errors returned to public endpoints must strip enum option lists (preserve field names only). No stack traces, no internal column names, no `error.message` from caught exceptions in 5xx responses.
- **Auto-issuance gate for security-sensitive grants:** any code path that auto-issues access (invite tokens, account approval, refunds) based purely on a score, threshold, or computed value MUST have a human-review intermediate state (`pending_review`) unless the user explicitly approved bypassing review.

**complexity-check:**
> "Does any new function exceed 50 lines, add an abstraction used only once, or add complexity the plan didn't call for?"

Specifics to check:
- Functions that do more than one thing
- Helper/utility files created for a single caller
- Premature abstractions (generic where specific suffices)
- Feature flags or backwards-compatibility shims for new code

**correctness-check:**
> "Do validation schemas match their type definitions (every field name, type, and nullability)? Are there dead parameters — including `_`-prefixed vars that were once used but aren't anymore? Does the output shape of each function match the input contract of its downstream consumer?"

Specifics to check:
- Validation schema fields vs the type/interface it mirrors — every field must appear in both
- Parameters prefixed with `_` that existed in a prior version of the function but are no longer read in the body
- Function A returns `{ foo, bar }` but function B (its only caller) destructures `{ foo, baz }` — shape mismatch
- Unsafe casts (e.g. `as unknown as X`) on embedded/joined query results — verify the actual return shape

**success-invariant-check:**
> "Can the changed workflow report success before the user-visible promise is fulfilled or before an explicit recoverable state is persisted?"

Specifics to check:
- Delivery/status/email/telemetry is written only after required side effects succeed
- Best-effort side effects are not actually customer-critical access paths
- A recoverable state includes enough error details for user/admin action
- Any prior incident cited in the plan has a regression guard
- No false-success shapes like `completed` plus an inaccessible resource, a missing token email, or a skipped generation step

**slop-check:**
> "Are there comments that narrate what the code does instead of why? Extra defensive checks abnormal for the surrounding code? Casts to `any`? Docblocks 3x longer than comparable files in the repo? Style inconsistencies with the rest of the file?"

Specifics to check:
- Comments like `// Step 1: do X`, `// Send email`, `// Check auth` — these narrate, not explain
- Module docblocks > 10 lines when comparable files in the same directory use 3-5 lines
- Section-separator comments (`// ===...`) that don't match the pattern used in the rest of the file
- `any` casts inserted to suppress type errors instead of fixing the underlying type

**operator-understanding-check:**
> "Does this PR include the operator-readable summary/artifact required by its selected understanding depth, and does it explain the problem, solution, tradeoff, impact, risks, and verification without requiring the operator/maintainer to read code?"

Specifics to check:
- `light` mode has a concise operator summary and a valid reason no durable artifact is needed
- `default` mode has an Operator Understanding section in the plan and PR Non-Engineer Summary
- `deep` mode has `plans/active/issue-###-understanding.md` or equivalent artifact plus teach-back marked complete or pending with reason
- Explanation starts from business/user behavior before code details
- Summary is consistent with the actual diff and tests

**test-quality-check:**
> "Do tests verify behavior through the highest correct public interface, and does every acceptance criterion have evidence or an accepted risk?"

Specifics to check:
- `.pipeline/acceptance-trace.json` maps every acceptance criterion to `covered`, `accepted-risk`, or `blocked`
- Covered criteria name a real test file/command in `.pipeline/test-evidence.json`
- Tests cross the same seam callers/users use: browser flow, API endpoint, or public library function
- Mocks are only at system boundaries (payment provider, email provider, version control APIs, time/randomness, filesystem when justified), not internal modules you control
- `TEST_SEAM_BLOCKED` entries include behavior, reason, risk, and architecture finding
- When the plan has an `Architecture Alignment` section, `.pipeline/architecture-alignment.json` links affected architecture-doc claims to tests, unchanged-code evidence, or accepted risk

**evidence-check:**
> "Do build/typecheck/test/smoke/claim-verification artifacts prove the stated behavior, and are `INCONCLUSIVE` results handled as risks instead of success?"

Specifics to check:
- `.pipeline/test-evidence.json` records the project's typecheck, build, targeted tests, and full-suite status or accepted blockers
- User-visible, CLI, API, performance, or memory claims are stated falsifiably before evidence is presented
- Claim verification verdicts are exactly `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE`
- `NOT VERIFIED` and `INCONCLUSIVE` entries are treated as blockers or accepted risks, not green evidence
- UI/CLI smoke evidence uses local harnesses, screenshots, transcripts, console/network logs, or equivalent raw artifacts where they matter

**reviewability-check:**
> "Can a reviewer understand the intent, risky files, generated/mechanical changes, and test evidence from the PR body and artifacts without reconstructing the run?"

Specifics to check:
- PR body or ship manifest separates core behavior files from generated/mechanical/supporting files
- Risky behavior changes, rollout concerns, accepted risks, and smoke/verification evidence are called out
- If the run updates an existing PR, blocking review comments were fetched, grouped, and addressed or explicitly answered
- CI readiness uses `gh pr checks` as the source of truth for PR-attached checks, not only `gh run list`

### Run for structural changes:

**architecture-check:**
> "Does this change violate patterns established in your conventions doc (CLAUDE.md / AGENTS.md), relevant `docs/architecture/` files, or the existing codebase?"

Specifics to check:
- Imports that break the project's module-resolution convention
- Client-only env vars used in server-side code (or vice versa)
- Wrong request/response types for the runtime the file targets
- New files in wrong directory (check your conventions doc and docs/architecture/ for conventions)

**architecture-docs-check:**
> "Does the PRD/plan cite the right architecture docs, does the code conform to those docs or update them in the same PR, and does `.pipeline/architecture-alignment.json` prove the verdict?"

Specifics to check:
- Plan includes `Architecture Alignment` with source-of-truth docs, code sources checked, alignment verdict, required doc updates, and test/review proof
- `.pipeline/architecture-alignment.json` exists when behavior described in `docs/architecture/` changed
- Every changed route, API endpoint, auth flow, data model, or generated artifact maps to the relevant doc listed in `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/PROJECT-CHECKS.md`
- If the code changes a documented behavior, the matching architecture doc changes in the same PR or the artifact records an explicit accepted risk
- If an architecture doc changes, its `Last verified against code` line is updated where present

**architecture-depth-check:**
> "Does this change improve or preserve module depth and locality? Are new seams justified by real adapters?"

Specifics to check:
- Shallow modules: interface nearly as complex as implementation
- Pass-through helpers or service wrappers that fail the deletion test
- New seams/ports with only one adapter and no test substitute or real variation
- Rules scattered across callers instead of concentrated behind one interface
- Tests reaching past the public interface because the module shape is wrong
- Interfaces exposing implementation details solely to satisfy tests

**strict-structure-check (conditional for broad/high-risk diffs):**
> "Is there a clear code-judo simplification that would delete complexity, avoid file-size blowups, or prevent spaghetti branching before shipping?"

Specifics to check:
- PR pushes a file past 1000 lines without a compelling reason
- New ad-hoc conditionals or special-case branches tangle an existing flow
- A cleaner ownership boundary or typed model would delete complexity instead of moving it around
- New wrappers, ports, helpers, casts, or optionality obscure the real invariant
- Feature logic leaks into a shared path when a canonical layer already owns the concept

### Run for external-facing content:

**voice-check:**
> "Does this content match the project voice? Is there corporate slop, AI-sounding language, or tone mismatch?"

### Run for portable evidence triggers:

Use the full binary definitions in `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/REVIEW-CHECKS.md`. Every N/A needs a concrete reason in the plan or review artifact.

**external-grounding-check:** Run when external API, SDK, provider, protocol, browser/platform behavior, or generated setup instructions determine a behavior claim. Verify authoritative current sources and implementation consequences.

**runtime-e2e-proof-check:** Run when preview, staging, production, remote, or other real-environment proof is claimed. Verify target/base revision, safe environment shape, guardrails, inherited failures, and proves/does-not-prove limits.

**surface-parity-check:** Run for a new/ported API, CLI, job, webhook, cron, or public entrypoint. Verify at least two siblings and explicit treatment of inherited auth, rate, error, telemetry, time, and header behavior.

**trust-map-check:** Run when consuming untrusted input or emitting a rendered/exported artifact. Verify each writer/neutralization and each output consumer/guard.

**volume-envelope-check:** Run for collection reads or per-item external calls. Verify busiest-case math and explicit page/concurrency/time bounds.

**lifecycle-state-check:** Run for stateful provider/token/access-grant/entitlement/money-adjacent objects. Verify behavior per consumed state and a negative test.

**ui-proof-check:** Run for user-visible claims. Verify revision-bound assertions and private/local artifacts without secrets, customer data, or anonymous public uploads.

### Run for payment / fee / pricing changes:

Trigger when the diff touches checkout, billing, webhook handlers for payments, or any file referencing application fees, discounted prices, promo/coupon codes, or discounts. (See `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/REVIEW-CHECKS.md` for project-specific triggers and the full pass/fail criteria.)

**payment-integrity-check:**
> "Do checkout, webhook, entitlement, coupon, invoice, and fee paths preserve money and access invariants?"

Specifics to check:
- The platform fee is calculated on the already-discounted price, not the list price. A caller that passes the list price overcharges silently. Discount resolution must go through the single canonical resolver.
- Promo/discount codes have one canonical resolution path. Do not bypass it with a payment-provider-hosted discount when the fee is fixed at session creation; that path drifts the effective fee.
- Two-path drift: if the same value is computable from multiple paths (e.g. discount via URL param vs typed in UI vs API param), all paths must funnel through the same resolver and produce identical results.
- Idempotency: webhook handlers and backfill scripts touching the same record must share the same helper and use a provider idempotency key keyed on a stable identifier, with self-correction where applicable.
- One-time vs subscription fee fields are different — don't apply one helper to both.
- Redemption counters and discount math should not run in the same transaction as the user-facing checkout call; counter writes belong in the webhook fire-and-forget path.
- Webhook idempotency row is inserted only after required handlers succeed.
- Paid access is granted exactly once and cannot be orphaned from purchase/customer records.

### Run for product intent / product promise changes:

Trigger when `.pipeline/classification.json` has `product_intent_gate: "applies"`, when `.pipeline/product-intent.json` exists, or when the diff changes product/GTM/user-flow behavior, pricing/packaging, onboarding promises, access/delivery boundaries, metrics, or copy that makes a user-visible promise.

**intended-vs-implemented-check:**
> "Does the implementation match the documented Product Intent, plan, architecture docs, and PR promises on the real code paths?"

Specifics to check:
- The intended outcome, target user/context, MVP boundary, and metric/proxy are present in the plan or PR body when the gate applies.
- Acceptance criteria and tests cover the intended behavior, not only implementation details.
- Money, access, data, privacy, delivery, trust, and product-promise boundaries match the documented intent.
- Any mismatch is fixed, the intent is explicitly updated, or the PR marks it as an accepted risk requiring human review.
- N/A is only valid with a concrete reason, not because the change is "small" while it still alters a product promise.

### Run for async / external side-effect changes:

Trigger when the diff touches background jobs, webhooks, cron handlers, queue publishing, email sending, version-control API calls, infrastructure management API calls, or long-running generation phases.

**async-reliability-check:**
> "Does each async side effect define idempotency, retry taxonomy, terminal states, observability, and recovery?"

Specifics to check:
- Retry `429`, `5xx`, and network failures with bounded backoff; do not blindly retry normal `4xx`
- Use idempotency keys, list-before-create, or stable unique constraints before retrying create operations
- Persist terminal success/failure states and actionable error details
- Long-running phases write heartbeats or progress before timeout-prone work
- Recovery does not depend only on future traffic; use cron/reaper/queue where needed

### Run for migration / schema changes:

Trigger when the diff touches migration files, schema templates, migration runners, or code that writes columns added by migrations.

**schema-migration-check:**
> "Do migrations, templates, writers, and schema docs stay coupled for both new and existing environments?"

Specifics to check:
- New migration files are registered in the migration runner
- Template schema and migrations remain equivalent for access control and policies
- Columns documented as written by a phase have the writer in the same PR
- Runtime writers do not assume columns that only exist in newly provisioned environments

### Run for identity / auth changes:

Trigger when the diff touches auth handlers, OAuth callbacks, invite tokens, the accounts/users model, or routing after login.

**identity-routing-check:**
> "Does auth/OAuth/invite code bind the right identity, classify roles correctly, and avoid orphan or broken-link states?"

Specifics to check:
- Tokens are bound to the email/account/user they were issued for
- Auth callbacks classify role before routing
- Account/auth-user relationships are validated or repaired safely
- Audits consider both missing rows and broken pointers

### Run for email / transactional communication changes:

Trigger when the diff touches email sending, email templates, signup/purchase confirmation, delivery email, or webhook paths that send user instructions.

**email-delivery-check:**
> "If an email carries the user's only token/link/instruction, is it treated as critical infrastructure with render tests, logging, retry, and recovery?"

Specifics to check:
- Rendered HTML/text include required links and variables
- Critical email failures are not swallowed as non-critical logs
- Email logs persist enough provider IDs/status to audit
- Retry or queue exists for transient provider failures

### Run for generated artifact changes:

Trigger when the diff touches generators, scaffold templates, seed data, or generated user-facing repo/instruction artifacts.

**generated-artifact-check:**
> "Do generated repos/templates contain no unresolved placeholders, missing manifest files, citation/markup tags, object-string leaks, or inaccessible delivery links?"

Specifics to check:
- No unresolved `{{PLACEHOLDER}}` in generated paths or contents
- No stray model citation/markup tags or `[object Object]` text leaks
- Bundle manifests reference files that are actually generated
- Private repo delivery verifies collaborator access before user email

### Run for UI journey changes:

Trigger when the diff touches user-facing forms, checkout, onboarding, dashboards, or page routes.

**ui-journey-check:**
> "Can a user complete and recover from the changed form/journey on desktop and mobile, including the likely failure path?"

Specifics to check:
- Validation errors appear under the right fields
- Browser autofill does not make valid forms unsubmitable
- Users can retry after fixable errors
- Mobile width around 375px remains usable

---

## Step 3: Collect Results

Each reviewer reports:

**Pass:**
```
PASS — security-check
Reviewed 4 files. No injection, XSS, auth bypass, or exposed secrets found.
Parameterized queries used correctly. Webhook signature verified.
```

**Fail:**
```
FAIL — security-check
File: api/webhook.ts:23
Code: `const body = JSON.parse(req.body)`
Issue: Webhook payload parsed without signature verification.
      Attacker can forge events and trigger free deliveries.
Fix: Verify the provider signature against the raw body before parsing.
     Reject invalid signatures with 400.
```

### What makes a good Fail report:

- **File and line number** — reviewer read the actual code
- **Exact code quote** — not a paraphrase
- **Specific issue** — what's wrong and what could happen
- **Specific fix** — not "improve this" but exact code change

### What makes a bad Fail report (discard these):

- "The naming could be more descriptive" — style preference, not correctness
- "Consider adding error handling" — vague, no specific failure scenario
- "This could be improved" — no file, no code, no fix
- "P2 — minor issue" — using severity scales instead of binary

## Step 4: Resolve

**All checks pass:** Proceed to next phase.

**Any check fails:**
1. Fix the specific issue identified in the Fail report
2. Re-run ALL checks on the changed files (not just the failing check) — a fix that satisfies one check can introduce bugs visible to another (e.g., extracting a helper to fix complexity creates a dead parameter visible to correctness-check)
3. If the same check fails twice on the same issue, HALT and surface to user

Before returning success, write `.pipeline/review-results.json` using the schema in `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/ARTIFACTS.md`.

---

## Standalone Usage

When invoked directly (not from `/yalla`):

```
/yalla-review
```

Runs against the current branch's diff from `$BASE_BRANCH`. Reports results. Does not auto-fix — presents findings for the user to act on.

---

## Anti-Patterns

- Reviewing style instead of correctness (naming preferences, comment quality)
- Holistic review ("rate the overall quality") instead of specific binary checks
- Flagging issues the agent wouldn't know are wrong without reading the codebase
- Using P1/P2/P3 severity instead of binary pass/fail
- Reviewing code you wrote yourself (author != reviewer)
- Reviewing before tests pass (fixes during review may break tests)
- Suggesting improvements beyond the scope of the current change
- Prefixing a parameter with `_` to suppress unused-var lint instead of removing it — the lint rule exists to catch dead code, not to be silenced
- Re-running only the failing check after a fix instead of all checks on the changed files
- Failing operator-understanding-check for wording preference rather than missing, misleading, or too-technical decision support
- Passing review without checking acceptance-trace/test-evidence artifacts
- Treating a shallow wrapper as architecture just because it has a new interface
- Marking `INCONCLUSIVE` verification as success
- Approving a PR that cannot be reviewed from its body, artifacts, and changed-file entry points
- Using GitHub Actions-only status commands when PR-attached checks require `gh pr checks`
- Treating intended-vs-implemented-check as generic doc alignment instead of comparing the documented intent to real code paths and evidence
