# Customizing Yalla for your project

The pipeline engine is generic. It knows how to classify, plan, build, test, review, and ship — but it knows nothing about *your* project. All of that lives in one file: `.claude/YALLA.md`. This is the config seam. You adapt Yalla by editing config, never by editing the engine.

That's the whole design. The skills and agents in `.claude/skills/` and `.claude/agents/` should look the same in every repo. The difference between a brand-new install and a config that's run thousands of tasks is entirely in `YALLA.md` and `knowledge/yalla/PROJECT-CHECKS.md`. Keep it that way — when you find yourself wanting to fork an agent, you almost always want a new gotcha or a new risk gate instead.

If you are onboarding a repository for the first time, start with [`docs/onboarding/`](docs/onboarding/) and then come back here for the deeper rationale. The mature reference for everything below is [`examples/sbf/`](examples/sbf/) — a real production config from an 8-subsystem Vite + Vercel + Stripe + Postgres app, plus the real proof fixtures in `eval/yalla/data/`. Read it after this guide; it shows what these sections look like once they've earned their keep.

## The config seam, section by section

### Identity

`repo`, `project_name`, `base_branch`, `tech_stack`.

Leave `repo: ""` to auto-detect via `gh repo view`. The `tech_stack` line is read by the planning agents as context — write it the way you'd describe your stack to a new engineer in one sentence. It's not decorative; it shapes what the analyst looks for.

### Commands

Your real `test` / `typecheck` / `build` / `lint` invocations. The pipeline runs these at the test and review gates. Two rules:

- Use the exact command you type by hand. If `npm test` needs an env file, encode that here.
- Set a command to `""` to skip its gate. No typecheck in your Python project? `typecheck: ""`. The gate disappears cleanly; it doesn't fail.

A test command that doesn't exist is the single most common reason a first run feels broken — and without a working test command most runs land `INCONCLUSIVE` instead of `PROVEN`, because the proof contract can't get deterministic evidence. Get these right before anything else.

### Model Routing

The optional `models:` block documents phase-level routing intent:

```yaml
models:
  classify: "cheap"
  plan: "sonnet"
  implement: "sonnet"
  test: "sonnet"
  review: "opus"
  summarize: "cheap"
```

Yalla treats these as validated hints rather than a hard runtime dependency. Some Claude Code/plugin hosts may ignore explicit model switching, but the config still matters: `npm run yalla:run -- doctor`, onboarding checks, status, and reports surface the intended cost/quality posture. Keep the keys to `classify`, `plan`, `implement`, `test`, `review`, and `summarize`; unknown keys fail onboarding so typos do not silently drift.

### Verifiers

The optional `verifiers:` block documents what proves success for each class of work:

```yaml
verifiers:
  api: "npm test -- tests/api"
  ui: "npm run test:e2e"
  browser_interactions: "npm run test:e2e -- --grep @browser-interaction"
  perf: "npm run benchmark"
  docs: "npm run docs:check"
  visual: ".pipeline/visual-evidence/"
```

These entries are planning/reporting hints. They make the verifier boundary explicit before a long-running loop starts, but they do not execute automatically. The agent still runs the appropriate command, saves the output, and maps it to the goal contract. See [`knowledge/yalla/VERIFIERS.md`](knowledge/yalla/VERIFIERS.md).

### Test Layout

`test_dir`, `test_file_glob`, `test_setup_file`. This tells the tester where to put new tests and how your existing ones are named, so generated tests match your conventions instead of inventing their own structure.

### Task Tracking

`tracking_mode` is `github` (default), `linear`, `file-only`, or `db`. `issue_id_format` is just how the pipeline names a unit of work (`issue-###`, `CAP-123`, or whatever your tracker uses). See [SETUP.md](SETUP.md) for when each mode applies.

For GitHub mode, labels and issue shape matter. Use [`docs/onboarding/task-system.md`](docs/onboarding/task-system.md) to create the default `yalla-ready`, block, and priority labels and to seed an issue template.

For Linear mode, keep the same Yalla proof contract but map it to Linear states instead of GitHub labels:

```yaml
tracking_mode: linear
issue_id_format: "CAP-###"
task_system:
  provider: linear
  team: CAP
  project: "Marketing Website"
  ready_states: [Ready, Selected]
  in_progress_state: "In Progress"
  review_state: "In Review"
  blocked_state: "Needs Human"
  done_state: Done
```

The operating rule is the same across trackers: intake the issue, write back the plan, move the task when work starts, attach the PR, and comment the final proof verdict. Scheduled automation should start in report-only/dry-run mode until those transitions are proven.

### Domain Mapping

Maps task-description keywords to a subsystem label:

```yaml
domains:
  - keywords: [payment, checkout, billing, invoice, subscription]
    domain: payments
```

Two jobs. First, it focuses the codebase analyst — a task mentioning "checkout" gets pointed at your payments code. Second, it's the trigger system for risk gates: the `payments` domain is what arms `payment-integrity-check`.

Fill this with *your* vocabulary. If your team says "ledger" instead of "billing", map `ledger`. The keywords are the words that actually appear in your task descriptions, not generic CS terms. Delete the section entirely if you don't want keyword routing.

### Known Gotchas — your scar tissue

This is the highest-leverage section in the file. Gotchas are pre-loaded into *every* run as hard constraints. They're the non-obvious rules that a new contributor — human or agent — would trip on and that no amount of reading the code would reveal.

Good gotchas are specific, actionable, and earned:

- "Always use `.js` extensions in TypeScript ESM imports — omitting breaks the runtime silently."
- "Webhook idempotency: insert the processed-event row AFTER the handler succeeds, never before."
- "All times stored in the DB are UTC — never persist a local timezone."

Bad gotchas are vague aspirations: "write clean code", "be careful with the database". Those teach the pipeline nothing.

The way you grow this section: every time a Yalla run (or a human) ships a bug that "everyone knew about", that's a missing gotcha. Add the rule that would have prevented it, phrased as a constraint. This is the **compound** phase feeding back into config — durable learnings route here (or to `docs/learnings/`), not into a forked agent. Over months this becomes the single most valuable artifact in your config. The SBF example has a couple dozen; yours starts with three and grows.

### Risk Gates

Subsystem review checks that run **only** when the diff touches matching paths:

```yaml
risk_gates:
  - name: payment-integrity-check
    triggers_on: [payments, billing, checkout]
```

The point of gates is proportionality. A docs typo should not be dragged through payment, migration, and auth review. A change to your billing code should be. List only the gates that match subsystems you actually have. The rest stay dormant — a gate that never triggers costs nothing, but a gate you don't need is noise.

For browser-heavy products, add a browser-interaction verifier even if the component-test stack is weak. The tester should use the real browser seam for regressions like:

- typing while autosave flips `Saving...` to `Saved`
- caret/focus jumping during debounced state updates
- text reverting after optimistic cache writes
- SPA navigation away/back durability
- console or network errors during the journey

If the project has no Playwright/Cypress/Browser harness yet, the run should record `TEST_SEAM_BLOCKED` or a `manual-smoke` proof instead of pretending a shallow render test proves the behavior.

### Scope Mode Defaults

How aggressively to scope each kind of work: `EXPANSION` (greenfield, new structure allowed), `HOLD` (match existing patterns), `REDUCTION` (minimal surgical change). The defaults are sensible — new features expand, bug fixes hold, hotfixes reduce. Tune only if your team has a different instinct about, say, refactors.

### Autopilot Defaults

The `autopilot` section documents whether this repo is allowed to run report-only or unattended loops. Keep `enabled: false` and `level: L0` until the queue dry-run works and the checklist in [`docs/autopilot/readiness-checklist.md`](docs/autopilot/readiness-checklist.md) passes. Autopilot uses the same labels described in the task-system onboarding doc.

### Memory (optional)

The `memory` section wires an optional durable-directive store into the pipeline: Phase 0b recalls relevant past directives *before* planning, and the compound phase persists new ones *after* a run proves out. It is **off unless you define the block**, and is independent of `tracking_mode` — you can track tasks in GitHub Issues yet recall learnings from a project store.

```yaml
memory:
  recall_enabled: true
  save_enabled: true
  recall_tool: "mcp__supabase__execute_sql"   # the MCP tool that runs the query
  save_tool: "mcp__supabase__execute_sql"
  tags_namespace: ["yalla", "your-repo"]       # every recall filters and every save tags with these
```

Recall is read-only and never blocks a run — a missing or failed store is a skipped phase, not a halt. Saves apply the **directive test** (a learning must be pasteable into Phase 0 and immediately change how an agent plans) and dual-write to the store *and* `docs/learnings/`. The optional `memory-routing-check` review gate enforces that durable knowledge lands in the store rather than scattered files. Full protocol, schema, and `recall_query`/`save_query` overrides are in [`knowledge/yalla/MEMORY-PROTOCOL.md`](knowledge/yalla/MEMORY-PROTOCOL.md) and [`knowledge/yalla/SQL-TEMPLATES.md`](knowledge/yalla/SQL-TEMPLATES.md).

## How task classification routes ceremony

Before planning, Phase 0 classifies the task and that classification decides how much process the run carries. You don't configure this directly — it's driven by the task description, your domain mapping, and your scope defaults — but understanding it explains why two runs feel so different:

- **tiny-hotfix** (one file, one value, clear failing test) → minimal evidence, no heavyweight artifacts, no full plan ceremony. Reproduce, fix, rerun the exact test, hostile self-review, PR.
- **bug / perf / hotfix** → a diagnosis gate runs *before* planning: reproduce the symptom, record falsifiable hypotheses, find a regression seam.
- **feature** → full vertical-slice build with acceptance criteria written before code.
- **architecture / refactor** → a depth-and-locality pass before any implementation.
- **prototype** → throwaway prototype first, production plan second.

The full routing table is in [`knowledge/yalla/TASK-CLASSIFICATION.md`](knowledge/yalla/TASK-CLASSIFICATION.md). Your `domains` and `scope_defaults` are the levers that nudge it for your project.

## The Proof Contract, evidence modes, and risk tiers

Every run ends with a verdict in `.pipeline/outcome-evaluation.json`: exactly one of `PROVEN`, `NOT_PROVEN`, or `INCONCLUSIVE`. Only `PROVEN` may be called done — and `PROVEN` requires that every acceptance criterion is backed by valid evidence (a passing test, static check, browser/API probe, or smoke run), every required review check passes, and no remaining delta exists. Missing evidence never becomes `PROVEN`. The contract prefers deterministic proof: it won't accept a model judge where a concrete test or check could verify the behavior.

Two knobs scale how heavy the proof apparatus is:

**Evidence mode** (`minimal` / `standard` / `strict`) — how many artifacts a run produces and commits:

- `minimal` — tiny-hotfix or docs-only. Reproduce/fix/verify lives in the PR body; committed `.pipeline/*` artifacts are usually unnecessary.
- `standard` — default. Local artifacts guide the run; commit only the ones useful for review.
- `strict` — high-risk work. Intent brief, hostile self-critique, acceptance trace, test evidence, and architecture-alignment proof.

**Risk tier** (`low` / `medium` / `high`) — how hard the review leans and how much a human should inspect:

- `low` — docs, tests, constants. Reviewable from the summary and evidence.
- `medium` — normal feature/fix touching a public interface.
- `high` — payments, auth, migrations, webhook/job reliability, generated artifacts, security, broad refactors. Stricter review, explicit accepted risks, a reviewer separate from the implementer.

You don't set these per run; classification picks them from the task and your config. Your job is to keep the domain mapping and gotchas honest so the right tier and mode fire on their own.

## Run observability and operator controls

The proof artifacts tell a reviewer whether the work is proven. The operator artifacts tell the maintainer where the run is, how to resume it, and what happened along the way.

From the cloned Yalla repo, use:

```bash
npm run yalla:run -- doctor --config /path/to/your-project/.claude/YALLA.md
npm run yalla:run -- event --config /path/to/your-project/.claude/YALLA.md --event stage.started --phase plan --message "Planning started"
npm run yalla:run -- checkpoint --config /path/to/your-project/.claude/YALLA.md --phase test --message "Focused tests passed"
npm run yalla:run -- status --config /path/to/your-project/.claude/YALLA.md
npm run yalla:run -- report --config /path/to/your-project/.claude/YALLA.md
npm run yalla:run -- resume --config /path/to/your-project/.claude/YALLA.md
npm run yalla:run -- rewind --config /path/to/your-project/.claude/YALLA.md --target plan
npm run yalla:run -- export --config /path/to/your-project/.claude/YALLA.md
```

These helpers are intentionally local-first. They write `.pipeline/events.jsonl`, `.pipeline/checkpoints/*`, `.pipeline/latest-checkpoint.json`, `.pipeline/report.html`, and portable `.pipeline/export-*` bundles. `rewind` identifies the checkpoint to inspect; it does not reset branches or delete work. That keeps Yalla's recovery path explicit and prevents automation from hiding destructive Git operations behind a friendly command.

For long-running autonomy, add these artifacts before or during the loop:

```bash
npm run yalla:run -- goal --config /path/to/your-project/.claude/YALLA.md --message "Desired end state" --criterion "Measurable success" --constraint "Do not break X" --evidence "npm test"
npm run yalla:run -- evaluate --config /path/to/your-project/.claude/YALLA.md --evaluator reviewer --verdict PASS --message "Evidence is sufficient"
npm run yalla:run -- loop --config /path/to/your-project/.claude/YALLA.md
npm run yalla:run -- mine-sessions --config /path/to/your-project/.claude/YALLA.md
```

`goal` writes `.pipeline/goal-contract.json`. `evaluate` writes `.pipeline/evaluator-results.json` and keeps evaluator judgment separate from executor changes. `loop` writes `.pipeline/loop-state.json` with the next non-destructive instruction. `mine-sessions` writes `.pipeline/session-mining-report.json` with suggested gotchas, project checks, or eval fixtures based on repeated failures.

## How binary review works

Every reviewer answers **one** specific yes/no question — and on a Fail must produce a file, a line, the offending code, and a concrete fix. They never rate 1–10.

This is deliberate. A 1–10 score is unfalsifiable; two reviewers can disagree forever and neither is wrong. A binary check is resolvable: either there's a hardcoded secret on line 42 or there isn't. Either the webhook verifies its signature before parsing or it doesn't. Disagreements become "show me the line", which ends arguments and makes fixes obvious.

It also means **the author never reviews their own code.** A reviewer answering "is there a SQL injection here?" with fresh eyes catches what the implementer, anchored on their own design, glosses over.

The canonical check library — every binary check, its question, and its Fail criteria — is [`knowledge/yalla/REVIEW-CHECKS.md`](knowledge/yalla/REVIEW-CHECKS.md). The universal checks (security, correctness, test-evidence, reviewability, complexity) run on most diffs; the risk-triggered ones (payment, async, schema-migration, identity, email, generated-artifact, UI-journey, browser-interaction) stay dormant until their subsystem is touched. Adopt the ones your project needs and leave the rest dormant.

## Writing a custom risk gate

A risk gate is a named check plus a checklist of binary criteria. Two files are involved:

1. **`knowledge/yalla/REVIEW-CHECKS.md`** — the canonical check library and the binary pass/fail format. Read this first; it defines how a check is structured and what counts as a blocking Fail.
2. **`knowledge/yalla/PROJECT-CHECKS.md`** — your project's actual checklists. This is where a gate's concrete, project-specific items live.

To add a gate:

1. Add the trigger to `YALLA.md` (`name` + `triggers_on` domains).
2. Add a checklist block to `PROJECT-CHECKS.md` under "Risk-Triggered Checklist". Each item is a single yes/no the reviewer can verify against the diff.

Worked example, lifted from the SBF reference — an async-reliability gate:

```markdown
### Async Reliability (jobs, webhooks, cron, external APIs)
- [ ] Retry taxonomy is explicit: retry 429/5xx/network, do not retry normal 4xx
- [ ] Create operations are idempotent via key, unique constraint, or list-before-create guard
- [ ] Long-running work writes heartbeat/progress or is split into bounded phases
- [ ] Stuck states have a cron/reaper/alert/manual recovery path
```

Notice every line is checkable against the code. None of them say "handle errors well." That's the bar.

## The universal baseline vs. the triggered checklist

`PROJECT-CHECKS.md` has two layers:

- **Universal Baseline** — applied to every run, but only where the touched files make an item relevant. Items that don't apply are marked N/A, not invented into busywork. These are your always-on invariants: no hardcoded secrets, parameterized queries, responsive UI, correct import extensions.
- **Risk-Triggered Checklist** — runs a block only when the diff or workflow matches its trigger. This is where the subsystem-specific scrutiny lives (payments, migrations, identity, email, generated artifacts, UI journeys, browser interactions).

The split is what keeps review proportional. Baseline is cheap and universal; triggered checks are deep and rare.

## Extending the eval harness

The eval harness (`eval/yalla/`) grades the pipeline against itself, and its proof checks are driven by JSON fixtures under `eval/yalla/data/`. The shipped fixtures are real SBF incidents and PRDs — `zod_interface_drift_review_gap`, `checkout_surface_parity_missing`, `deterministic_seam_model_judge_only`, and so on — each one a regression guard for a specific failure mode the pipeline must keep catching.

Use [`docs/onboarding/evals.md`](docs/onboarding/evals.md) for the practical checklist: when to add a fixture, which fixture file to use, and what to verify before increasing automation.

To add your own proof check:

1. Pick the suite it belongs to — proof-contract, test-inventory, plan-review-coverage, or outcome-quality — and open the matching `eval/yalla/data/*.json` fixtures.
2. Add a fixture that encodes the failure you want guarded: an input run plus the verdict the harness should produce (e.g. a run that should land `NOT_PROVEN` because it leaned on a model judge where a deterministic seam existed).
3. Run `npm run eval:yalla:smoke` to confirm the fixture is exercised and the suite still passes.

The point is the same as gotchas: every real failure you hit becomes a fixture so the proof contract keeps catching it. The SBF fixtures show the shape.

## Scaling review depth by priority

You don't run the full reviewer panel on every change. Classification matches depth to risk automatically, but the instinct to encode is:

- **Trivial / tiny-hotfix** — baseline only. A copy fix or a config tweak doesn't need the architecture reviewer.
- **Normal feature work** — baseline plus whatever risk gates the domain mapping triggers.
- **High-priority or high-blast-radius** — full panel, every relevant gate, strict evidence mode, and the heavier `/yalla-team` multi-agent path where reviewers work in parallel with fresh context.

The domain mapping does most of this routing: a change tagged `payments` pulls in the payment gate without you asking. Your job is to keep the mapping honest so the right depth fires on its own.

## Where to go next

Read [`examples/sbf/`](examples/sbf/) end to end. It's not a template to copy — it's intentionally specific to one stack — but it's the clearest picture of what a `YALLA.md`, a `PROJECT-CHECKS.md`, and a set of real proof fixtures look like after they've absorbed thousands of real tasks. Steal the *shape*, fill it with *your* scar tissue.
