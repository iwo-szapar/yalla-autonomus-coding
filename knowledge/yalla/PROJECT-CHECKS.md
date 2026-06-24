# Project-Specific Checks (Template)

Reference file for yalla-reviewer and yalla-tester.

> **This is a template — replace examples with your project's checks.** The items below are a generic baseline. Swap in the conventions a reviewer should enforce on every relevant PR in *your* codebase, plus the risk-triggered gates for *your* subsystems. See `examples/sbf/PROJECT-CHECKS.md` for a real, mature example from a production app that has run thousands of tasks through the pipeline.

Most checks should map to gotchas in `.claude/YALLA.md` and to a check defined in `knowledge/yalla/REVIEW-CHECKS.md`. Keep this file project-specific; keep the reusable check *definitions* in REVIEW-CHECKS.md.

---

## Universal Baseline

Apply these where the touched files make them relevant. Mark unrelated items N/A instead of inventing work.

- [ ] **All UI is responsive (RWD)** — layouts readable at a small mobile width (e.g. 375px), no desktop-only components
- [ ] No secrets/keys hardcoded (check for token-prefix patterns and credential-looking strings)
- [ ] Database queries use parameterized values (no string interpolation of user input)
- [ ] No unsafe HTML rendering of user-controlled input without sanitization
- [ ] Input from external sources is validated before use
- [ ] File paths normalized to `/` before any cross-machine comparison (Windows sends `\`)
- [ ] `process.env.HOME` has a `USERPROFILE` fallback (or equivalent) for Windows
- [ ] No OS-only shell commands without a cross-platform alternative
- [ ] New code follows the import/module conventions of the surrounding files

> Replace or extend these with the conventions specific to your stack (import-extension rules, route ordering, env-var boundaries, request/response types, etc.). Keep the cross-platform and security items.

## Risk-Triggered Checklist

Run a section only when the touched files or workflow match its trigger. A docs-only wording PR should not be forced through every section.

### Success Invariant (when a workflow status changes)
- [ ] Plan states the success invariant for the changed workflow
- [ ] Code cannot mark `completed`, `delivered`, `sent`, or equivalent before required side effects succeed
- [ ] Recoverable failures persist actionable details for user/admin recovery

### Product Intent (product/GTM/user-flow promises)
- [ ] Plan or PR states the intended outcome, target user/context, metric/proxy, and MVP boundary
- [ ] Top kill-assumptions have cheap validation or are accepted risks
- [ ] Acceptance criteria prove the intended behavior, not only implementation details
- [ ] `.pipeline/product-intent.json` exists when the intent is non-obvious or review-relevant
- [ ] `intended-vs-implemented-check` is run and its verdict appears in review evidence

### Async Reliability (jobs, webhooks, cron, external APIs)
- [ ] Retry taxonomy is explicit: retry `429/5xx/network`, do not retry normal `4xx`
- [ ] Create operations are idempotent via key, unique constraint, or list-before-create guard
- [ ] Long-running work writes heartbeat/progress or is split into bounded phases
- [ ] Stuck states have a cron/reaper/alert/manual recovery path

### Schema / Migration Coupling
- [ ] Migration files are registered with whatever runner applies them
- [ ] Schema docs/templates and the actual migrations stay aligned for columns, constraints, and policies
- [ ] Columns described as written by runtime code have writers and tests in the same PR
- [ ] Code handles records that predate the migration (don't assume a new column exists everywhere)

### Identity / Routing
- [ ] Invite/signup/API tokens are bound to the email/account/user they were issued for
- [ ] Auth/OAuth callbacks classify the identity/role before routing
- [ ] Account/auth audits check both missing rows and broken pointers
- [ ] Parent suspension/deletion revokes dependent sessions/tokens/API keys

### Email / Notification Delivery
- [ ] Rendered HTML/text include the required CTA/token/link placeholders for the path
- [ ] Critical messages are retried/queued or fail the workflow into a recoverable state
- [ ] Delivery logs include provider IDs/status sufficient for audit

### Generated Artifacts (codegen, templating, scaffolding)
- [ ] No unresolved `{{...}}` placeholders remain in generated paths or content
- [ ] No `[object Object]`, stray model-output tags, or other known artifacts remain
- [ ] Manifests reference files that are actually generated
- [ ] Access-gated links are shared only after access is verified

### UI Journeys
- [ ] Changed journey has happy-path and likely negative-path coverage
- [ ] Fixable errors can be retried without manual DB/support intervention
- [ ] Errors render under the correct fields
- [ ] Mobile width (~375px) remains usable

### Browser Interaction Durability
- [ ] User typing is not lost or reverted during save/debounce/optimistic-update cycles
- [ ] Caret, selection, and focus remain stable for the changed editing/form flow
- [ ] Navigation away/back and reload preserve the expected saved state
- [ ] Browser evidence captures unexpected console errors and failed network requests
- [ ] Manual repro steps are converted into browser assertions, or `TEST_SEAM_BLOCKED`/`manual-smoke` evidence explains why automation is unavailable

## Architecture-Doc Source Map

Use this before writing a PRD/plan, before testing, and during review. Map task-description keywords to the architecture docs they touch. Replace the generic targets below with your project's real doc paths.

- [ ] Platform/data-boundary/account changes -> your architecture overview and data-boundary docs
- [ ] Signup/checkout/purchase/onboarding/delivery/journey changes -> your core-flows doc
- [ ] Frontend route additions/removals/renames -> your routing doc
- [ ] Auth/session/OAuth behavior -> your auth doc
- [ ] Tool/endpoint/quota/integration changes -> your API reference and integration docs
- [ ] Code/artifact generation or async generation jobs -> your generation/pipeline docs
- [ ] Provisioning/credential-storage changes -> your provisioning docs
- [ ] Data ingestion/import/sync changes -> your ingestion doc

## PRD / Plan Architecture Alignment

- [ ] PRD or plan has an `Architecture Alignment` section before implementation starts
- [ ] Relevant architecture docs are cited by path, not described generically
- [ ] Affected code sources are listed by path and were checked against the docs
- [ ] Alignment verdict is explicit: `aligned`, `docs-drift`, `code-drift`, or `intentional-change-updates-docs`
- [ ] Required doc updates are listed by path or explicitly `none`
- [ ] Test evidence needed to prove architecture claims is mapped to acceptance criteria
- [ ] If the PRD intentionally changes architecture, the same PR updates the corresponding architecture doc unless the user accepted a documented risk

## Architecture Alignment Test Evidence

- [ ] `.pipeline/architecture-alignment.json` exists when any architecture-doc source-map row applies
- [ ] The artifact lists relevant docs, changed code paths, alignment verdict, docs updated, and evidence
- [ ] `.pipeline/test-evidence.json` includes architecture-doc alignment status, not just command results
- [ ] Tests cover behavior through the public seam used by the architecture doc claim
- [ ] Claims that cannot be behavior-tested are recorded as unchanged-code evidence or accepted risk

## Imported Process Gates

Use these when the task triggers the relevant surface or failure mode. Mark `N/A` only with a reason.

- [ ] Build/typecheck failures are grouped by file/category before fixes begin
- [ ] User-visible, CLI, API, performance, or memory claims are stated falsifiably and recorded as `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE`
- [ ] UI changes use a browser/devtools/automation harness or record why automated UI evidence is blocked
- [ ] Browser-interaction bugs assert the actual browser-visible invariant instead of relying only on component render tests
- [ ] CLI/TUI/script changes use a deterministic local harness or transcript where manual poking would be ambiguous
- [ ] Smoke/e2e checks record flake risk separately from deterministic failures
- [ ] Existing PR updates fetch and address blocking review comments before shipping
- [ ] PR readiness and post-push loops use `gh pr checks` as the source of truth
- [ ] PR body identifies reviewer entry points, risky behavior changes, accepted risks, and test evidence
- [ ] Merge conflict resolution stays minimal, leaves no markers, and regenerates lockfiles through package tools
- [ ] Broad/high-risk diffs run strict structural review for code-judo simplification, spaghetti growth, file-size blowups, and unearned abstractions

## Doc-Alignment Checklist (when public-facing surfaces change)

Run when tools/commands, endpoints, routes, config keys, or migrations change. Replace the placeholders with your project's real doc paths.

- [ ] API reference lists every new/changed endpoint
- [ ] Tool/command docs match the registered tools/commands in code (names and counts)
- [ ] Route/navigation docs include new/changed routes
- [ ] Schema reference reflects new/changed tables and columns
- [ ] Config/env reference includes new keys
- [ ] Getting-started / integration docs match current auth methods and setup steps
- [ ] "Last updated" lines reflect today's date where the doc was changed
