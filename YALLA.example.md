# YALLA Config

# Copy this file to `.claude/YALLA.md` in your repo and fill it in.
# The yalla pipeline reads this in Phase 0. It is the single place you adapt
# the pipeline to your project — repo identity, commands, conventions, gotchas.
# Human-maintainable. No code changes needed to onboard a new project.

## Identity

# Leave repo blank to auto-detect with `gh repo view --json nameWithOwner`.
repo: ""                        # e.g. "your-org/your-repo" (optional; auto-detected)
project_name: my-project
base_branch: main               # branch new work is cut from and PRs target
tech_stack: "<describe your stack — e.g. Node + TypeScript + Postgres>"

## Commands

# The pipeline runs these at the test/build gates. Use whatever your project uses.
# Set to "" to skip a gate (e.g. no typecheck in a Python project).
commands:
  install: "npm install"
  test: "npm test"
  typecheck: "npm run typecheck"
  build: "npm run build"
  lint: "npm run lint"

## Model Routing (optional)

# Phase-level model hints. Claude Code/plugin hosts may ignore these if they do
# not support explicit model switching, but Yalla surfaces and validates them so
# the intended cost/quality posture is visible in doctor/status/report output.
models:
  classify: "cheap"             # fast/cheap model is enough for routing
  plan: "sonnet"                # strong planner for grounded design
  implement: "sonnet"           # default build model
  test: "sonnet"                # can be cheaper if tests are mechanical
  review: "opus"                # independent high-rigor review when available
  summarize: "cheap"            # PR/report summaries

## Verifiers (optional)

# Project-specific proof commands or artifact locations. These are planning and
# reporting hints; agents still run the relevant commands and record evidence.
verifiers:
  api: "npm test"
  ui: "npm run test:e2e"
  perf: "npm run benchmark"
  docs: "npm run docs:check"
  visual: ".pipeline/visual-evidence/"

## Test Layout

# Where tests live and how they're named — the tester agent matches these.
test_dir: tests/
test_file_glob: "**/*.test.*"
test_setup_file: tests/setup.ts   # shared setup, or "" if none

## Task Tracking

# "github" (default, recommended): GitHub Issues are the canonical task store.
# "file-only": no external store; state lives in .pipeline-state.json + plans/.
# "db": advanced — a SQL task table (see knowledge/yalla/SQL-TEMPLATES.md).
tracking_mode: github
issue_id_format: "issue-###"      # how the pipeline refers to a unit of work

## Task System (optional, recommended for GitHub mode)

# These labels should exist in GitHub if you use queue dry-run or scheduled
# autopilot. See docs/onboarding/task-system.md for setup commands and the
# recommended issue template.
task_system:
  ready_label: yalla-ready
  block_labels: [blocked, needs-human, do-not-autopilot]
  priority_labels: [p0, p1, p2]
  risk_labels: [risk:low, risk:medium, risk:high]
  issue_template: ".github/ISSUE_TEMPLATE/yalla-task.md"

## Autopilot Defaults (optional)

# These fields document your repo's automation posture. The shipped autopilot
# command is dry-run only; scheduled or unattended modes should follow
# docs/autopilot/ and require explicit repo opt-in.
autopilot:
  enabled: false
  level: L0                    # L0, L1, L2, L2.5, or L3
  human_mode: strict           # fyi, approval, or strict
  eligible_labels: [yalla-ready]
  block_labels: [blocked, needs-human, do-not-autopilot]
  max_risk_tier: low
  max_iterations: 3
  max_files_changed: 12
  max_runtime_minutes: 45
  token_budget: "repo-defined"
  auto_merge: false            # keep false unless explicitly opted in per run

## Eval Posture (optional)

# The bundled evals live in the Yalla repo. Add project-specific fixtures after
# real failures or recurring review misses; see docs/onboarding/evals.md.
evals:
  smoke_command: "npm run eval:yalla:smoke"
  project_fixtures_required_before_autopilot: true

## Ceremony Defaults (optional)

# Ceremony controls artifact volume and review depth, not proof honesty. Only
# PROVEN is success in every mode.
ceremony:
  default_mode: standard             # lean, standard, strict
  allow_user_override: true          # /yalla lean ... or /yalla strict ...
  minimum_diff_default_files_budget: 5
  minimum_diff_default_loc_budget: 200

## Memory (optional)

# A durable directive store the pipeline recalls before planning (Phase 0b) and
# writes to after compounding (Phase 5). Independent of `tracking_mode` — you can
# track tasks in GitHub Issues yet recall learnings from a project memory store.
# Omit this whole section to disable both. See knowledge/yalla/MEMORY-PROTOCOL.md
# and the optional memory tables in knowledge/yalla/SQL-TEMPLATES.md.
memory:
  recall_enabled: false             # Phase 0b: pre-load prior directives as constraints
  save_enabled: false               # Phase 5: persist new actionable directives
  recall_tool: ""                   # MCP tool that runs the query, e.g. mcp__supabase__execute_sql
  save_tool: ""                     # usually the same tool as recall_tool
  tags_namespace: ["yalla"]         # JSONB tag root; append an org/repo tag for multi-project stores
  # recall_query / save_query: optional overrides. The pipeline uses the reference
  # shapes in MEMORY-PROTOCOL.md when these are blank. Placeholders: {namespace} {domain} {keyword}

## Domain Mapping (optional)

# Map task-description keywords → a subsystem label. Used to focus the
# codebase-analyst and to decide which risk gates are likely to trigger.
# Delete this section if you don't want keyword routing.
domains:
  - keywords: [auth, login, oauth, session, token, signup]
    domain: auth
  - keywords: [payment, checkout, billing, invoice, subscription]
    domain: payments
  - keywords: [migration, schema, database, table, column]
    domain: data
  - keywords: [api, endpoint, route, handler]
    domain: api
  - keywords: [ui, page, component, form, screen]
    domain: frontend
  - keywords: [job, queue, cron, webhook, worker]
    domain: async

## Known Gotchas (optional)

# Pre-loaded into every run as hard constraints. This is where a project's
# scar tissue lives — the non-obvious rules a new contributor would trip on.
# Replace these examples with your own. Keep them specific and actionable.
gotchas:
  - "Example: imports in `src/server/` must use the `.js` extension or the runtime fails silently."
  - "Example: never log request bodies — they can contain PII."
  - "Example: all user-facing UI must be responsive and usable at 375px width."

## Risk Gates (optional)

# Subsystem review gates that run ONLY when the diff touches matching paths.
# Full catalog + pass/fail criteria live in knowledge/yalla/REVIEW-CHECKS.md.
# List the ones relevant to your project; the rest stay dormant.
risk_gates:
  - name: payment-integrity-check
    triggers_on: [payments, billing, checkout]
  - name: async-reliability-check
    triggers_on: [async, jobs, webhooks]
  - name: schema-migration-check
    triggers_on: [data, migration]
  - name: identity-routing-check
    triggers_on: [auth]
  - name: ui-journey-check
    triggers_on: [frontend]
  - name: doc-alignment-check
    triggers_on: [api, public-docs]
  - name: memory-routing-check       # only meaningful when a `memory:` store is configured
    triggers_on: [docs, learnings, knowledge]

## Scope Mode Defaults (optional)

# How aggressively to scope each kind of work. EXPANSION = greenfield, allow new
# structure. HOLD = match existing patterns. REDUCTION = minimal surgical change.
scope_defaults:
  greenfield_feature: EXPANSION
  new_page: EXPANSION
  new_api: EXPANSION
  bug_fix: HOLD
  refactor: HOLD
  hotfix: REDUCTION
  security_patch: HOLD
  large_diff: REDUCTION       # diffs touching many files default to REDUCTION
