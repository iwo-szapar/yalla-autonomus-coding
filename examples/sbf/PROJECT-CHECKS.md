# Project-Specific Checks — Second Brain Factory (sanitized reference)

Reference file for yalla-reviewer and yalla-tester. These checks are specific to a Vite + React + TypeScript + Vercel + Supabase + Stripe Connect project. This is a sanitized copy kept as a worked example — see how a universal baseline, risk-triggered checklists, and an architecture-doc alignment gate look once a team has matured them. The internal doc paths are kept on purpose: they illustrate a real doc-alignment gate.

---

## Universal Baseline

Apply these where the touched files make them relevant. Mark unrelated items N/A instead of inventing work.

- [ ] **All UI is responsive (RWD)** — layouts readable at 375px, uses Tailwind responsive prefixes, no desktop-only components
- [ ] API imports have `.js` extensions
- [ ] Routes added BEFORE catch-all `*` in App.tsx
- [ ] No `VITE_` env vars in server-side code (api/ directory)
- [ ] VercelRequest/VercelResponse used (not Web API Request/Response)
- [ ] Stripe webhook verifies signatures
- [ ] Database queries use parameterized values (no string interpolation)
- [ ] No secrets/keys hardcoded (check for patterns like `sk_`, `pk_`, `re_`)
- [ ] No unsafe HTML rendering without sanitization
- [ ] File paths normalized to `/` before cross-machine comparison (Windows sends `\`)
- [ ] `process.env.HOME` has `USERPROFILE` fallback for Windows
- [ ] No Unix-only shell commands without Windows alternative

## Risk-Triggered Checklist

Run these only when the touched files or workflow match the trigger. A docs-only wording PR should not be forced through Stripe, email, auth, and repo-generation checks.

### Customer Success Invariant (when a workflow status changes)
- [ ] Plan states the success invariant for the changed workflow
- [ ] Code cannot mark `completed`, `delivered`, `emailSent`, or equivalent before required side effects succeed
- [ ] Recoverable failures persist actionable details for user/admin recovery

### Async Reliability (jobs, webhooks, cron, external APIs)
- [ ] Retry taxonomy is explicit: retry `429/5xx/network`, do not retry normal `4xx`
- [ ] Create operations are idempotent via key, unique constraint, or list-before-create guard
- [ ] Long-running work writes heartbeat/progress or is split into bounded phases
- [ ] Stuck states have cron/reaper/alert/manual recovery path

### Schema / Migration Coupling
- [ ] Tenant migration files are registered in `scripts/run-tenant-migrations.ts`
- [ ] Tenant template schema and tenant migrations stay aligned for columns, RLS, and policies
- [ ] Columns described as written by runtime phases have writers and tests in the same PR
- [ ] Existing tenants and new tenants both receive the intended schema behavior

### Identity Routing
- [ ] Invite/signup/API tokens are bound to the email/account/user they were issued for
- [ ] OAuth callback classifies creator/customer/unknown before routing
- [ ] Account/auth audits check both missing rows and broken pointers
- [ ] Parent suspension/deletion revokes dependent sessions/tokens/API keys

### Email Delivery
- [ ] Rendered HTML/text include required CTA/token/link placeholders for the product path
- [ ] Critical emails are retried/queued or fail the workflow into recoverable state
- [ ] Email logs include provider IDs/status sufficient for audit

### Generated Artifacts
- [ ] No unresolved `{{...}}` placeholders remain in generated paths or content
- [ ] No `<cite ...>` tags, `[object Object]`, or known AI artifacts remain
- [ ] Bundle manifests reference files that are actually generated
- [ ] Private repo links are emailed only after collaborator access is verified

### UI Journeys
- [ ] Changed journey has happy path and likely negative path coverage
- [ ] Fixable errors can be retried without manual DB/support intervention
- [ ] Errors render under the correct fields
- [ ] Mobile width around 375px remains usable

## Architecture-Doc Source Map

Use this before writing a PRD/plan, before testing, and during review. Mark a row `N/A` only when the touched files cannot affect that subsystem.

- [ ] Platform, tenant, routing, or account/data-boundary changes -> `docs/architecture/overview.md`, `docs/architecture/platform-architecture.md`, `docs/architecture/multi-tenant.md`, `docs/decisions/003-account-based-multi-tenant-architecture.md`
- [ ] Signup, checkout, purchase, questionnaire, delivery, creator application, or customer journey changes -> `docs/architecture/flows.md`
- [ ] Frontend route additions/removals/renames -> `docs/architecture/frontend-routing.md`
- [ ] Frontend auth/session/OAuth behavior -> `docs/architecture/frontend-auth.md`
- [ ] MCP endpoint, tool, auth, quota, or customer/creator tool split changes -> `docs/architecture/mcp-system-design.md`, `docs/reference/mcp-endpoints.md`, `docs/getting-started/customer-mcp.md`, `docs/getting-started/mcp-integration.md`
- [ ] Repo generation, preview generation, clone mode, scaffold/full mode, generated repo artifacts, delivery phases, or async generation jobs -> `docs/architecture/repo-generator.md`, `docs/architecture/repo-generator-overview.md`
- [ ] Managed/BYOD provisioning, Supabase credential storage, tenant database provisioning, or OAuth Supabase changes -> `docs/architecture/managed-vs-byod.md`, `docs/architecture/multi-tenant.md`
- [ ] Context ingestion/import/sync changes -> `docs/architecture/context-ingestion.md`

## PRD / Plan Architecture Alignment

- [ ] PRD or plan has an `Architecture Alignment` section before implementation starts
- [ ] Relevant `docs/architecture/*` files are cited by path, not described generically
- [ ] Affected code sources are listed by path and were checked against the docs
- [ ] Alignment verdict is explicit: `aligned`, `docs-drift`, `code-drift`, or `intentional-change-updates-docs`
- [ ] Required doc updates are listed by path or explicitly `none`
- [ ] Test evidence needed to prove architecture claims is mapped to acceptance criteria
- [ ] If the PRD intentionally changes architecture, the same PR updates the corresponding architecture doc unless the user accepted a documented risk

## Architecture Alignment Test Evidence

- [ ] `<run-state>/architecture-alignment.json` exists when any architecture-doc source-map row applies
- [ ] The artifact lists relevant docs, changed code paths, alignment verdict, docs updated, and evidence
- [ ] `<run-state>/test-evidence.json` includes architecture-doc alignment status, not just command results
- [ ] Tests cover behavior through the public seam used by the architecture doc claim
- [ ] Claims that cannot be behavior-tested are recorded as unchanged-code evidence or accepted risk

## Imported Process Gates

Use these when the task triggers the relevant surface or failure mode. Mark `N/A` only with a reason.

- [ ] Build/typecheck failures are grouped by file/category before fixes begin
- [ ] User-visible, CLI, API, performance, or memory claims are stated falsifiably and recorded as `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE`
- [ ] UI changes use a browser/devtools/Playwright harness or record why automated UI evidence is blocked
- [ ] CLI/TUI/script changes use a deterministic local harness or transcript where manual poking would be ambiguous
- [ ] Smoke/e2e checks record flake risk separately from deterministic failures
- [ ] Existing PR updates fetch and address blocking review comments before shipping
- [ ] PR readiness and post-push loops use `gh pr checks` as the source of truth
- [ ] PR body identifies reviewer entry points, risky behavior changes, accepted risks, and test evidence
- [ ] Merge conflict resolution stays minimal, leaves no markers, and regenerates lockfiles through package tools
- [ ] Broad/high-risk diffs run strict structural review for code-judo simplification, spaghetti growth, file-size blowups, and unearned abstractions

## Doc-Alignment Checklist (when MCP tools, migrations, endpoints, or routes change)

### Tier 1: Must validate (code-specific facts that drift)
- [ ] `docs/reference/mcp-endpoints.md` tool counts match actual files in `lib/mcp/tools/` and `lib/mcp/tools/customer/`
- [ ] `docs/reference/mcp-endpoints.md` tool tables list every registered tool
- [ ] `docs/product/developer-onboarding.md` migration list includes all files in `lib/db/migrations/`
- [ ] `docs/product/developer-onboarding.md` tool table matches registered customer MCP tools
- [ ] `CLAUDE.md` API endpoint table includes new/changed endpoints
- [ ] `CLAUDE.md` frontend routes table includes new/changed routes
- [ ] `docs/getting-started/customer-mcp.md` tool names/setup match current customer MCP tools
- [ ] `docs/getting-started/mcp-integration.md` auth methods and endpoints are current
- [ ] `docs/product/developer-onboarding.md` "Last updated" line reflects today's date if changes made

### Tier 2: Spot-check (when relevant subsystem changes)
- [ ] `docs/reference/tenant-schema.md` reflects tenant table columns after new tenant migrations
- [ ] `docs/architecture/mcp-system-design.md` matches current MCP architecture
- [ ] `docs/guides/stripe-connect.md` matches Stripe integration patterns
- [ ] `docs/product/product-index.md` lists current products accurately
- [ ] `docs/architecture/repo-generator-overview.md` matches repo generation pipeline phases
