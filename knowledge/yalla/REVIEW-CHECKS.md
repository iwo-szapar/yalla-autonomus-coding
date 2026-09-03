# Review Check Definitions

Reference file for yalla reviewers. Defines binary pass/fail checks for code review. This is the canonical check library.

Each reviewer answers one specific question. Pass or Fail. No severity scales.

Universal checks stay small and run on most diffs. Risk-triggered checks run only when the diff touches the matching subsystem; do not make every PR answer every historical failure mode. The payment/email/artifact/identity checks below are a reusable LIBRARY — adopt the ones your project needs and leave the rest dormant.

---

## security-check

> "Does this change introduce SQL injection, XSS, SSRF, auth bypass, exposed secrets, or missing input validation?"

**Pass:** No injection vectors, no unsafe HTML rendering, no auth gaps, no exposed secrets, webhook/external-callback signatures verified.

**Fail criteria:**
- String interpolation of untrusted input in SQL instead of parameterized queries
- Unsafe HTML rendering with user-controlled input
- API endpoint accessible without auth when it should require it
- Secrets/keys committed in code (token-prefix or credential-looking strings)
- Webhook handler processes payload without signature verification
- Internal `error.message` or stack leaked to clients in error responses

## correctness-check

> "Do schemas, types, parameters, outputs, downstream contracts, and success invariants match the promised behavior?"

**Pass:** Data shapes and contracts agree across caller/callee boundaries, and the workflow cannot report success before the user-visible promise or durable recovery state exists.

**Fail criteria:**
- Validation schema and type definition disagree on field name, type, or nullability
- Function output shape does not match downstream consumer expectations
- Dead parameter remains after behavior changed, including `_`-prefixed suppression
- Unsafe cast hides a known API/return shape mismatch
- Writes `completed`, `delivered`, `sent`, or equivalent before required side effects succeed
- Swallows a failure that leaves a user paid/provisioned but unable to act

## test-evidence-check

> "Do tests and validation evidence prove every acceptance criterion through the highest correct public seam, with blocked or inconclusive evidence treated as risk?"

**Pass:** Every acceptance criterion is covered by behavior test evidence or accepted risk. Tests use the highest correct seam and mock only system boundaries.

**Fail criteria:**
- Acceptance criterion missing from `.pipeline/acceptance-trace.json` or PR evidence
- Criterion marked covered without a test command/evidence
- Test mocks internal modules controlled by this repo instead of crossing the public interface
- `TEST_SEAM_BLOCKED` is unresolved or missing behavior/reason/risk/architecture finding
- Tests only assert rendering/compilation while the behavior is user/API/tool visible
- Claim verification verdict is `NOT VERIFIED` or `INCONCLUSIVE` but presented as success

## external-grounding-check

> "When external behavior matters, are the implementation and its claims grounded in current authoritative evidence?"

Run for external APIs, SDKs, providers, protocols, browser/platform behavior, or generated setup instructions.

**Fail criteria:**
- `.pipeline/external-grounding.json` or equivalent PR evidence is missing
- Source is stale, non-authoritative without justification, or does not support the claimed behavior
- Code/tests do not reflect the documented consequence
- `inconclusive` grounding is presented as `PROVEN`

## runtime-e2e-proof-check

> "When a run claims a real environment, does its evidence state exactly what the run can and cannot prove?"

Run for preview, staging, production, remote, or other real-environment evidence.

**Fail criteria:**
- Target environment or base revision is absent
- Environment/data shape or mutation guardrails expose secrets/customer data or are missing
- Baseline failures are silently attributed to the change
- `unresolved-proof-gap` or an untested behavior is presented as `PROVEN`

## surface-parity-check

> "Does a new or ported public entrypoint preserve the relevant behavior of its nearest siblings?"

Run for a new or ported API, CLI, job, webhook, cron, or public entrypoint.

**Fail criteria:**
- Fewer than two nearest siblings are checked without a concrete reason
- Auth, rate limits, error taxonomy, telemetry, time budgets, or headers are silently omitted
- A divergence lacks an explicit rationale and evidence

## trust-map-check

> "Are hostile inputs neutralized and outputs guarded for their actual consuming context?"

Run when untrusted input is consumed or an artifact/export/rendered output is emitted.

**Fail criteria:**
- Writer/hostile status or neutralization is not enumerated for an input
- Output consumer context or escaping/guard is unknown
- Review checks only the producer and ignores the downstream execution context

## volume-envelope-check

> "Is collection or per-item external work bounded for the busiest realistic case?"

**Fail criteria:**
- No concrete busiest case or cost math
- Pagination, concurrency, timeout, or truncation bound is absent
- A large or unbounded collection can amplify calls, cost, or run time unexpectedly

## lifecycle-state-check

> "Does code define behavior for every consumed state of a stateful external object?"

Run for providers, tokens, access grants, entitlements, and money-adjacent objects.

**Fail criteria:**
- Consumed states are implicit or incomplete
- A terminal/negative state can report success
- No negative test guards the most consequential state transition

## ui-proof-check

> "Do UI claims have revision-bound evidence that safely demonstrates the claimed behavior?"

**Fail criteria:**
- Assertions do not name the user-visible behavior they prove
- Screenshot/trace/recording is stale, missing, or detached from the tested revision
- Sensitive data appears in the artifact or it is uploaded to an anonymous/public host by default

## reviewability-check

> "Can a reviewer understand the intent, risk, changed behavior, evidence, and entry points without reconstructing the run?"

**Pass:** PR body or intent brief identifies goal, risk tier, reviewer entry points, validation evidence, docs impact, accepted risks, and generated/mechanical files.

**Fail criteria:**
- PR body omits risk tier or validation evidence
- Reviewer entry points are missing for a broad/medium/high-risk diff
- Generated/mechanical/supporting files are mixed with core behavior changes without explanation
- Accepted risks or blocked evidence are hidden
- CI readiness uses `gh run list` instead of PR-attached `gh pr checks`

## intended-vs-implemented-check

> "When Product Intent applies, does the implementation match the documented intent, plan, architecture docs, and PR promises on the real code paths?"

Run when `.pipeline/classification.json` has `product_intent_gate: "applies"`, when `.pipeline/product-intent.json` exists, or when the diff changes product/GTM/user-flow behavior, pricing/packaging, onboarding promises, access/delivery boundaries, metrics, or copy that makes a user-visible promise.

**Pass:** The plan/PR states intended outcome, target user/context, metric/proxy, and MVP boundary; acceptance criteria and evidence prove the intended behavior; money/access/data/privacy/delivery/trust/product-promise boundaries match the documented intent.

**Fail criteria:**
- Product/GTM/user-flow work has no Product Intent section and no concrete N/A reason
- Acceptance criteria verify only implementation mechanics while the user-visible promise remains unproven
- Code changes money, access, data, privacy, delivery, trust, or product-promise boundaries differently from the documented intent
- PR body promises behavior that tests or code paths do not prove
- Mismatch is neither fixed, documented as updated intent, nor marked as an accepted risk requiring human review

## complexity-check

> "Does this add avoidable abstraction, oversized functions, or YAGNI complexity?"

Run for structural changes, broad diffs, or when the plan triggers it.

**Pass:** All new complexity is called for by the plan and supported by existing patterns or real variation.

**Fail criteria:**
- Function body exceeds ~50 lines without a compelling local pattern
- Helper/utility created for a single call site where inline code is clearer
- Generic abstraction where specific code suffices
- Feature flag or backwards-compatibility shim for brand-new code without a concrete need

## slop-check

> "Are comments, casts, defensive checks, or style drift abnormal for the surrounding code?"

Run for medium/high-risk or broad diffs, not every tiny fix.

**Fail criteria:**
- Comments narrate obvious steps instead of explaining why
- Broad casts (e.g. `any`) suppress type errors instead of fixing the type
- Defensive branches are inconsistent with the surrounding module's invariants
- New docblocks/section comments are much longer or noisier than comparable files

## architecture-check

> "Does this change violate patterns from your project's conventions doc (CLAUDE.md / AGENTS.md), `.claude/YALLA.md` gotchas, the relevant architecture docs, or the existing codebase?"

**Fail criteria:**
- Violates an import/module convention the surrounding files follow
- Adds a route/handler in the wrong order or location per repo conventions
- Uses a server-only or client-only construct on the wrong side of the boundary
- New files in the wrong directory per repo conventions
- UI component not responsive around a small mobile viewport
- Branches behavior on string-literal product/tier identifiers in webhook/job/cron handlers instead of data/config-driven behavior

## architecture-docs-check

> "Does the plan cite the right architecture docs, does code conform or update them in the same PR, and does evidence prove the verdict?"

**Fail criteria:**
- Plan changes behavior covered by an architecture doc but has no `Architecture Alignment` section
- Relevant architecture doc omitted from the source map
- Code changes a documented flow, route, API, tool, data boundary, generation mode, payment path, onboarding flow, or generated artifact without updating the matching architecture doc or recording accepted risk
- `.pipeline/architecture-alignment.json` or equivalent PR evidence is missing when the architecture-doc gate applies
- Artifact claims `aligned` but diff changes code/docs on only one side of the documented behavior

## architecture-depth-check

> "Does this change improve or preserve module depth and locality? Are new seams justified by real adapters?"

**Fail criteria:**
- New module is a pass-through wrapper that fails the deletion test
- New seam/port has only one adapter and no concrete test substitute or real variation
- Business rule is duplicated across callers instead of concentrated behind one interface
- Interface exposes implementation details only to make tests possible
- Tests must reach into private implementation because the public seam is missing or wrong

## cross-platform-check

> "Does this change break on Windows or cross-machine path handling?"

**Fail criteria:**
- `path.relative()` or `path.resolve()` output used in cross-machine comparison without normalizing `\` to `/`
- Hardcoded `/` separator where paths can come from the client or OS
- `process.env.HOME` assumed without `USERPROFILE` fallback when relevant
- OS-only shell commands without a fallback in cross-platform scripts

## voice-check

> "Does this content match the project voice?"

**Fail criteria:**
- Corporate language, generic claims, or AI-sounding filler
- Passive voice where active is natural
- Tone inconsistent with surrounding site/product copy

## async-reliability-check

> "Does each async side effect define idempotency, retry taxonomy, terminal states, observability, and recovery?"

**Fail criteria:**
- Blindly retries create operations without idempotency key, unique constraint, or list-before-create guard
- Returns success to webhook/job queue after a required side effect failed
- Long-running job can exceed the platform timeout without heartbeat/progress or phase split
- Stuck state has no cron/reaper/alert/manual recovery path

## schema-migration-check

> "Do migrations, templates, writers, and schema docs stay coupled for both new and existing records?"

**Fail criteria:**
- Migration exists on disk but is not registered with the runner that applies it
- New template and old-record migration diverge on columns, constraints, or policies
- Migration adds a runtime-written column without changing or validating the writer
- Code assumes a column exists without handling records that predate the migration

## identity-routing-check

> "Does auth/OAuth/invite code bind the right identity, classify the role correctly, and avoid orphan or broken-link states?"

**Fail criteria:**
- Invite/signup/API token can be used by a different identity than intended
- OAuth callback routes before classifying the identity/role
- Code only audits one side of an auth/account relationship and misses broken pointers
- Deletes/suspensions leave dependent sessions/tokens active

## payment-integrity-check

> "Do checkout, webhook, entitlement, coupon, invoice, and fee paths preserve money and access invariants?"

(Reusable library check — enable when your project handles payments.)

**Fail criteria:**
- Fee/refund/discount calculated from a different amount than the customer was charged
- Webhook marks processed before all required handlers succeed
- Product-specific behavior hardcoded by identifier in webhook/job/cron handlers
- Entitlement/token/customer records can be duplicated or orphaned by retries

## email-delivery-check

> "If an email carries the user's only token/link/instruction, is it treated as critical infrastructure with render tests, logging, retry, and recovery?"

(Reusable library check — enable when your project sends transactional email.)

**Fail criteria:**
- Purchase/delivery/signup email can fail while the workflow still reports success
- Template omits the required CTA/token/link for the path
- Provider rate limit or 5xx has no retry/queue
- Email logs cannot prove whether the email was sent

## generated-artifact-check

> "Do generated repos/templates contain no unresolved placeholders, missing manifest files, stray model-output tags, object-string leaks, or inaccessible delivery links?"

(Reusable library check — enable when your project generates code/content artifacts.)

**Fail criteria:**
- Generated path/content still contains unresolved `{{...}}`
- Output contains stray model-output tags, `[object Object]`, or other known artifact leakage
- Bundle manifest references files not generated
- Access-gated delivery can share a link before access is verified

## ui-journey-check

> "Can a user complete and recover from the changed form/journey on desktop and mobile, including the likely failure path?"

**Fail criteria:**
- Fixable validation error permanently blocks retry
- Error appears under the wrong field or gives no user action
- Browser autofill leaves valid fields unread by submit logic
- Changed UI is not readable/usable around a small mobile width

## browser-interaction-check

> "Does browser evidence prove the interaction invariant a human would otherwise test manually, including typing, caret/focus stability, save-state transitions, navigation, reload, console, and network behavior?"

**Fail criteria:**
- A manual repro involving typing, autosave, navigation, reload, focus, or caret behavior is marked proven without browser-level evidence
- The test only renders a component or mocks internal state, so it cannot observe the reported regression
- The browser proof ignores console errors, failed network requests, or save-state transitions that are part of the user-visible failure
- Persisted text/state is not checked after navigation away/back or reload when durability is part of the claim

## operator-understanding-check

> "Does this PR include the operator-readable summary required by its understanding depth, explaining problem, solution, tradeoff, impact, risks, and verification without requiring the operator/maintainer to read code?"

**Fail criteria:**
- Non-Engineer Summary is missing for non-trivial work
- Summary describes code mechanics instead of business/user impact
- Tradeoff or recovery path a non-engineer must decide on is omitted or misleading

## memory-routing-check

Only meaningful when `.claude/YALLA.md` configures a `memory:` store with `save_enabled: true`. Dormant otherwise.

> "Did durable knowledge from this run go to the configured memory store (e.g. `memory_knowledge`) and `docs/learnings/`, rather than ad-hoc files scattered under a `memory/` directory?"

**Fail criteria:**
- A new arbitrary file was created under `memory/` when the configured store should have been used
- A learning was written to a file but never inserted into the store, so Phase 0b can never recall it
- The memory INSERT is missing `tags_namespace` or the matched `domain`/`"directive"` tags, making it unrecallable
- Wisdom that fails the directive test (see MEMORY-PROTOCOL.md) was stored as if it were a directive
