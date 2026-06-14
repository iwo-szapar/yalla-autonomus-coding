---
name: yalla
description: >
  Adaptive autonomous pipeline: classify -> track -> plan -> work -> test -> review -> compound -> ship.
  Uses GitHub Issues as the canonical engineering task store (`issue-###`).
  Use when building any feature, fix, or change that needs tracking inside this repo.
  Do NOT use for docs/config-only changes (use /quick) or when you just need
  task tracking without autonomous execution (use /begin).
argument_hint: "[description of what to build, or issue-### to resume]"
---

# /yalla

Adaptive autonomous development pipeline. It classifies the task, chooses the right engineering path, creates or resumes a GitHub issue, plans from domain/code evidence, builds in vertical tracer-bullet slices, tests through public interfaces, reviews with binary gates, captures learnings, and ships a PR.

Default shipping policy: create a PR only. Do not merge unless the user explicitly asked for auto-merge in this run.

`$REPO` is the target repository, resolved from `repo:` in `.claude/YALLA.md`, or auto-detected with `gh repo view --json nameWithOwner -q .nameWithOwner`. `$BASE_BRANCH` is the branch new work is cut from and PRs target, resolved from `base_branch:` in `.claude/YALLA.md` (default `main`). Build/test commands come from the `commands:` block in `.claude/YALLA.md`; `npm test` is used here only as a generic default example.

> **Locating bundled files.** Reference files shown as `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/*.md` and `${CLAUDE_PLUGIN_ROOT}/agents/*.md` are the Yalla engine, bundled with this plugin — read them from there. (If Yalla was vendored into the repo with `install.sh`, those same files live under `.claude/knowledge/yalla/` and `.claude/agents/`.) `.claude/YALLA.md` is always your project's own config and lives in your repo, not the plugin.

## Operating Principle

Keep the universal pipeline small. Do not make every PR carry every historical scar.

For every changed workflow, define its success invariant: the workflow is not successful until the user-visible promise is fulfilled or the system has entered an explicit, observable recovery state. Then activate only the risk gates that match the files and subsystem touched.

For non-trivial work, also apply the operator-understanding protocol (see `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/`): the run is not operator-ready until the operator/maintainer has a plain-English explanation of the problem, solution, tradeoff, impact, risks, and verification. Use the protocol's `light/default/deep` modes so small changes do not inherit a full teaching ceremony.

Bias toward launchable increments. Prefer the smallest user-testable version that can reach real users without violating the success invariant. Do not expand scope to make the system feel complete unless the user-visible promise requires it.

Treat each branch/worktree as a shippable save point. If the work is too broad to review, test, or roll back as one coherent user-visible change, split it into phase PRs instead of carrying one large diff to the end.

Coordinate against the base branch before multiplying work. If the base is red because of a shared blocker, fix or wait for that blocker first, then rebase dependent work before opening new PRs. Parallel agents are useful only when they do not all inherit the same known-red baseline.

Optimize for human attention, not line-by-line human review. The pipeline must produce enough intent, risk, validation, and documentation evidence that the user can decide where to look closely. Low-risk changes should be reviewable from the PR summary and evidence; medium/high-risk changes must clearly point to the risky files and decisions.

## Input

`#$ARGUMENTS`

If empty, ask "What are we building?" Do not proceed without a clear description.

## Hard Rules

- GitHub Issues are canonical for engineering work.
- Canonical ID format is `issue-###`.
- Do not invent a parallel ID scheme for new work; reference issues by `issue-###`.
- If GitHub CLI is unavailable, halt and ask the user to run `gh auth login`. (An optional SQL task store is described in `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/SQL-TEMPLATES.md`; only use it if `.claude/YALLA.md` sets `tracking_mode: db`.)
- Every run must produce `.pipeline/outcome-evaluation.json` before shipping.
- Every non-tiny run must start from `.pipeline/goal-contract.json` or an equivalent issue body section that names desired end state, success criteria, constraints, budget, forbidden shortcuts, and required evidence. Use `npm run yalla:run -- goal ...` when the cloned Yalla repo is available.
- Every non-tiny run must append structured lifecycle entries to `.pipeline/events.jsonl` and write checkpoints after classify, plan, each meaningful work slice, test, review, and ship. Use `npm run yalla:run -- event ...` and `npm run yalla:run -- checkpoint ...` when the cloned Yalla repo is available.
- Executor and evaluator roles are separate. The evaluator reads goal/evidence/diff and writes `.pipeline/evaluator-results.json`; it does not implement its own fixes.
- Before shipping, generate or refresh `.pipeline/report.html` with `npm run yalla:run -- report` when the run produced meaningful evidence artifacts.
- Only verdict `PROVEN` may be described as done, complete, ready to merge, or safe for autopilot progression.
- Verdicts `NOT_PROVEN` and `INCONCLUSIVE` are honest outcomes, not success states.

---

## Protocol References

Read these on demand. They are the source of truth for the upgraded pipeline:

- `.claude/YALLA.md` — repo config, gotchas, domain mapping, base branch defaults, commands
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/TASK-CLASSIFICATION.md` — adaptive task routing and merge policy
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/MINIMUM-DIFF.md` — pre-plan ladder for the smallest safe diff
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/DIAGNOSIS.md` — bug/perf feedback loop before fixing
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/VERTICAL-SLICES.md` — tracer-bullet planning/building
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/TEST-SEAMS.md` — behavior tests through public interfaces
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/ARCHITECTURE-DEPTH.md` — deep-module/locality review vocabulary
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/ARTIFACTS.md` — evidence schemas and artifact commit policy
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/VERIFIERS.md` — verifier selection, goal contracts, evaluator separation, and long-running loop artifacts
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/AGENT-BRIEF.md` — durable issue contract
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/PROJECT-CHECKS.md` — universal, risk-triggered, and architecture-doc alignment checks
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/MEMORY-PROTOCOL.md` — optional Phase 0b recall + Phase 5 save, only when `.claude/YALLA.md` sets a `memory:` block
- `${CLAUDE_PLUGIN_ROOT}/knowledge/product/PRODUCT-INTENT-FRAMEWORK.md` — conditional product-intent gate for product/GTM/user-flow changes
- `${CLAUDE_PLUGIN_ROOT}/knowledge/product/INTENDED-VS-IMPLEMENTED.md` — review method for comparing documented intent to implementation evidence

## Imported Cursor Team-Kit Patterns

These upstream Cursor team-kit skills are folded into `/yalla` as conditional gates, not copied as separate skills. Use them only when their trigger appears during a run:

| Upstream skill | Pipeline use |
|---|---|
| `check-compiler-errors` | When build/typecheck fails, group errors by file/category, fix the highest-confidence root cause first, then rerun the same command. |
| `deslop` | Prefer focused cleanup over broad rewrites; only touch slop while fixing a clear bug. |
| `verify-this` | For measurable claims, write a falsifiable claim, capture baseline/treatment evidence when possible, and return `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE` in test evidence. |
| `control-ui` | For UI changes, use repo-native browser/Playwright/devtools harnesses, screenshots, console/network logs, and accessibility snapshots instead of visual guessing. |
| `control-cli` | For CLI/TUI/scripts, use a deterministic local harness or transcript instead of manual poking. |
| `run-smoke-tests` | Run focused smoke/e2e checks when a user flow or integration needs end-to-end proof; record flake risk separately. |
| `fix-ci` / `loop-on-ci` | After PR creation, use `gh pr checks` as the source of truth, fix one actionable failure at a time, and rerun the full PR check set after every push. |
| `get-pr-comments` | When updating an existing PR, fetch review comments and discussion comments, group by actionability, and address blocking feedback before shipping. |
| `make-pr-easy-to-review` | Before creating/updating the PR, ensure summary, test notes, risk notes, and reviewer entry points match the actual diff. |
| `fix-merge-conflicts` | Resolve conflicts non-interactively with minimal edits, remove all markers, regenerate lockfiles with package tools, then rerun validation. |
| `thermo-nuclear-code-quality-review` | For broad or high-risk diffs, run an optional strict structural review focused on code-judo simplification, spaghetti growth, file-size blowups, and unearned abstractions. |

Do not import `new-branch-and-pr`, `weekly-review`, `what-did-i-get-done`, `workflow-from-chats`, or `pr-review-canvas` into the default run. They are already owned by `/yalla` or outside this pipeline's shipping path.

---

## Proof Contract

A `/yalla` run is good only when the user-visible promise in the GitHub issue is proven by artifacts, not prose.

Required proof fields:

- Issue intent in concrete user-visible terms.
- Acceptance criteria created before implementation.
- At least one negative, failure-path, or false-success criterion.
- Proof mode for every criterion: `existing-test`, `new-test`, `playwright`, `static-artifact`, `manual-smoke`, `model-judge`, or `inconclusive`.
- Implementation evidence.
- Review evidence.
- Final outcome verdict: exactly `PROVEN`, `NOT_PROVEN`, or `INCONCLUSIVE`.
- Remaining delta.

Proof rules:

- Prefer deterministic proof. Do not use `model-judge` when a concrete test, static check, browser check, API probe, or smoke harness can verify the behavior.
- Missing evidence produces `NOT_PROVEN` or `INCONCLUSIVE`, never `PROVEN`.
- `INCONCLUSIVE` may still open a PR, but the PR must clearly say human review or external evidence is needed.
- Known equivalent public surfaces must be checked together (e.g. two pages rendering the same form).
- If review causes code changes, rerun the relevant checks and record the rerun evidence.
- Do not say `done`, `complete`, `ready to merge`, or equivalent unless `.pipeline/outcome-evaluation.json` has verdict `PROVEN`.

---

## Pre-Flight

Run before Phase 0:

```bash
gh auth status
gh issue list --repo "$REPO" --limit 1 >/dev/null
```

Set local state fields to:

```json
{
  "tracking_mode": "github",
  "github_available": true,
  "phase": "0-classify"
}
```

Do not fall back to file-only task IDs unless `.claude/YALLA.md` sets `tracking_mode: file-only`. File-only plans are otherwise allowed only after a real GitHub issue exists.

---

## Phase 0a: Classify

Read `.claude/YALLA.md`, `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/TASK-CLASSIFICATION.md`, and `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/MINIMUM-DIFF.md`.

Classify the task before planning:

1. Determine `task_type` (`tiny-hotfix`, `bug`, `perf`, `feature`, `refactor`, `architecture`, `ui-prototype`, `logic-prototype`, `docs`, `hotfix`).
2. Determine `scope_mode` (`EXPANSION`, `HOLD`, `REDUCTION`).
3. Determine `required_gates`.
4. Determine `phase_split_required`:
   - `true` when the work spans multiple product surfaces that cannot ship/test/rollback as one coherent user-visible change, multiple risky subsystems, more than two meaningful user-visible slices, or cannot be manually tested as one coherent change.
   - `false` only when one PR can stay independently shippable, reviewable, and rollbackable.
5. Determine `risk_tier` (`low`, `medium`, `high`).
6. Determine `evidence_mode` (`minimal`, `standard`, `strict`).
7. Determine `ceremony_mode` (`lean`, `standard`, `strict`):
   - `lean` when the user invokes `/yalla lean ...`, or when tiny/minimal evidence mode is enough.
   - `standard` by default.
   - `strict` when the user invokes `/yalla strict ...`, or when high-risk evidence mode applies.
   - Ceremony changes artifact volume and review depth, not honesty; only `PROVEN` is success in every mode.
8. Determine `minimum_diff_decision` by running the ladder in `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/MINIMUM-DIFF.md` before planning. Record selected rung, higher rungs checked, reuse targets, skipped complexity, and file/LOC budget.
9. Determine `merge_policy`:
   - Default: `pr-only`
   - Only set `auto-merge-approved` if the user explicitly asked to merge/automerge.
10. Determine `architecture_doc_gate`:
   - `applies` if the task changes a route, auth flow, API endpoint, data model, or any behavior already described in your architecture docs (`docs/architecture/`).
   - `n/a` only with a short reason.
11. Determine `product_intent_gate`:
   - `applies` if the task changes product behavior, user/admin/operator journeys, GTM/pricing/positioning surfaces, money, access, entitlements, delivery, onboarding, public product pages, generated artifacts, or agent workflows that decide what gets built.
   - `n/a` for tiny hotfixes, isolated tests, dependency/config updates, mechanical refactors, or docs edits that do not define future product behavior. Include a specific reason.
12. Write `.pipeline/classification.json` and add the same fields to `.pipeline-state.json`.
13. Write or update `.pipeline/goal-contract.json` with success criteria, constraints, budget, forbidden shortcuts, and required evidence.
14. Record the phase in `.pipeline/events.jsonl` and checkpoint with phase `classify`.

### Conditional routing

- `tiny-hotfix` -> for one-file or one-value fixes with a clear failing test, use minimal evidence mode: reproduce the failure, make the smallest fix, rerun the exact failing test, run `git diff --check`, perform a hostile self-review inline or in PR notes, and skip committed `.pipeline/*` artifacts unless the decision is non-obvious.
- `bug` / `perf` / `hotfix` -> run the diagnosis gate before full planning.
- `ui-prototype` -> create a throwaway UI prototype first, then plan production work after the user selects a direction.
- `logic-prototype` -> create a throwaway terminal/state prototype first, then plan production work after the model is validated.
- `architecture` -> run an `architecture-depth` exploration before proposing implementation.
- Ambiguous domain terms -> ask one precise question at a time before plan approval; update durable docs only when the decision is durable.
- Product/GTM/user-flow ambiguity -> load `/product-intent` and record Product Intent before technical planning. Do not use Product Intent to expand scope; use it to narrow the MVP and name kill criteria.

Do not silently downgrade a gate. If a required gate cannot run, record the blocker and ask the user to accept the risk or change scope.

---

## Phase 0: Track

### Existing Issue

If input matches `issue-###`:

```bash
ISSUE_NUMBER="###"
gh issue view "$ISSUE_NUMBER" \
  --repo "$REPO" \
  --json number,title,body,url,state,labels,assignees
gh issue edit "$ISSUE_NUMBER" \
  --repo "$REPO" \
  --add-label "status/in-progress,executor/agent" \
  --remove-label "status/backlog,status/ready,status/blocked"
```

Use the issue title/body as planning input.

### New Issue

If input is a description:

1. Auto-detect priority: `p1` for bug/fix/broken/security/failing; `p3` for docs/refactor/cleanup/research; `p2` default; `p0` only for outage/security incident/data loss.
2. Create issue with labels: `priority/<p>`, `executor/agent`, `source/yalla`, `status/in-progress`.
3. Extract the issue number from the created URL.

```bash
ISSUE_URL=$(gh issue create \
  --repo "$REPO" \
  --title "[P2] $DESCRIPTION" \
  --label "priority/p2,executor/agent,source/yalla,status/in-progress" \
  --body "$(cat <<'EOF'
## Context

Yalla tracking issue. Full Agent Brief will be added after plan approval.

## Acceptance Criteria

- [ ] Implementation satisfies the requested change.

## Technical Approach

To be filled during planning.

## Links

- PR:
- Plan:
- Incident:
EOF
)")
ISSUE_NUMBER=$(basename "$ISSUE_URL")
```

### Branch / Worktree

Create branch from `$BASE_BRANCH`:

```bash
git fetch origin "$BASE_BRANCH"
SLUG=$(printf "%s" "$DESCRIPTION" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | cut -c1-30)
git worktree add -b "session/issue-$ISSUE_NUMBER-$SLUG" ".claude/worktrees/issue-$ISSUE_NUMBER-$SLUG" "origin/$BASE_BRANCH"
```

If already in a Claude Code worktree flow, use the equivalent worktree-entry mechanism.

State must include `issue_number`, `issue_url`, `branch`, `task_type`, `scope_mode`, `required_gates`, `phase_split_required`, `risk_tier`, `evidence_mode`, `ceremony_mode`, `minimum_diff_decision`, `architecture_doc_gate`, `architecture_doc_gate_reason`, `product_intent_gate`, `product_intent_gate_reason`, `merge_policy`, and `phase: "1-plan"`. It must not introduce a parallel ID scheme outside `issue-###`.

---

## Phase 0b: Pre-Flight Recall (optional)

Runs only when `.claude/YALLA.md` defines a `memory:` block with `recall_enabled: true`. Independent of `tracking_mode` — a repo can track tasks in GitHub Issues yet recall durable directives from a project memory store. If no `memory:` block exists, skip this phase entirely. See `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/MEMORY-PROTOCOL.md`.

1. Read the `memory:` config: `recall_tool` (the MCP tool that runs the query, e.g. `mcp__supabase__execute_sql`), `recall_query` (a SQL or query template with `{namespace}`, `{domain}`, `{keyword}` placeholders), and `tags_namespace`.
2. Map the task to domains using the YALLA.md `domains:` mapping (already produced in Phase 0a).
3. Run the configured `recall_query` for each matched domain plus the raw task keywords, limiting to the most recent handful of directives. A reference shape:
   ```sql
   SELECT title, content FROM memory_knowledge
   WHERE tags @> '{namespace}'::jsonb
     AND (tags @> '["{domain}"]'::jsonb OR content ILIKE '%{keyword}%')
   ORDER BY created_at DESC LIMIT 5;
   ```
4. Pre-load recalled directives as hard constraints for Phase 1 planning — treat them like YALLA.md gotchas.
5. Record the recalled directive titles in `.pipeline-state.json` (`recalled_directives`) so the plan and compound phases can reference them. If recall returns nothing, record `recalled_directives: []` and continue.

Recall is read-only. Never block the pipeline on a memory miss; a missing or failed memory store is a skipped phase, not a halt.

---

## Phase 1: Plan

### Diagnosis gate for bugs/perf/hotfixes

If `required_gates` includes `diagnosis`, read `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/DIAGNOSIS.md` and build the feedback loop before writing the full implementation plan.

Required before proceeding:

- The user-reported symptom is reproduced, or the blocker is documented.
- 3-5 falsifiable hypotheses are recorded.
- `.pipeline/diagnosis.json` exists.
- A regression test seam is identified, or `TEST_SEAM_BLOCKED` is documented.

### Planning path

For complex work, invoke `/yalla-plan`. For simple work, plan directly using the same required sections after reading the codebase.

If `product_intent_gate: "applies"`, load `/product-intent` or read `${CLAUDE_PLUGIN_ROOT}/knowledge/product/PRODUCT-INTENT-FRAMEWORK.md`, `${CLAUDE_PLUGIN_ROOT}/knowledge/product/ASSUMPTION-TESTING.md`, and `${CLAUDE_PLUGIN_ROOT}/knowledge/product/METRICS-FRAMEWORK.md` before writing the technical plan. The Product Intent section must name the target actor, desired outcome, metric moved, load-bearing assumptions, cheapest validation, kill criteria, MVP scope, and intended behavior. If GTM-facing, also read `${CLAUDE_PLUGIN_ROOT}/knowledge/product/GTM-DISCOVERY.md`.

If Product Intent is `N/A`, record the specific reason in the plan. Do not force product discovery onto tiny fixes.

Before any technical approach, apply `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/MINIMUM-DIFF.md` and preserve the Phase 0a `minimum_diff_decision`. If implementation reality expands the file/LOC budget, update the plan with why the smaller rung failed before editing beyond the budget.

Before the implementation plan, write `plans/active/issue-###-[slug]-research.md` when the task is non-trivial: multiple domains, prior implementation reuse, external API/library uncertainty, UI/product ambiguity, or more than one phase PR. Keep it high signal:

- Existing code paths and patterns checked.
- Relevant docs, prior incidents, and learnings.
- External docs or competitor/product research when useful.
- What to reuse, ignore, or delete from prior implementations.
- Open risks and phase split recommendation.

Decide whether this issue should become phase PRs. If `phase_split_required: true`, create a parent issue plan and define child issue/PR phases where every phase is independently shippable, user-testable, and rollbackable. Do not create child phases that only move internals without a demoable user or operator outcome unless the user approves an infrastructure-only phase.

For UI changes, add a design pre-pass before implementation planning:

- Existing design system constraints and components to reuse.
- Typography, color, density, and layout direction.
- Desktop and 375px mobile behavior.
- Screenshots, references, or prototypes to inspect.
- Non-goals so the agent does not drift into generic redesign.

For ambiguous UI, product, architecture, or milestone choices, create a visual planning artifact before asking for approval. Use a concise HTML file or similarly scannable artifact instead of a long wall of markdown when the user needs to compare options. Include clear option cards, tradeoffs, risk level, and a recommended choice. The artifact is planning aid, not a requirement for tiny fixes.

Use subagents deliberately when exploration would bloat the main context:

- Codebase archaeology across many files.
- External docs or competitor research.
- Independent implementation experiments where several approaches can be tested in parallel.
- Validation passes that should return conclusions and evidence, not every intermediate search.

Subagents should return concise findings, files checked, confidence, and unresolved questions. Do not dump raw exploration into the main context.

Before implementation, check the current base/PR health when GitHub is available:

- If a known failing check is unrelated and already has a fix PR, either rebase after that PR lands or document the inherited failure in the PR body without changing unrelated files.
- If the same failing check will block several parallel PRs, pause dependent implementation and ship the shared blocker first.
- If the blocker is in scope for this issue, make it the first vertical slice.

Before writing the plan, use `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/PROJECT-CHECKS.md` to map every changed public behavior to its `docs/architecture/` source of truth. Compare those docs against current code and record whether code, docs, or both need to change.

Write plan to `plans/active/issue-###-[slug].md`. If a JSON artifact is useful for review or resume, write `plans/active/issue-###.plan.json` using the schema in `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/ARTIFACTS.md`.

Plan structure:

```markdown
# issue-###: [title]

## Problem
[What's broken or missing — grounded in codebase evidence.]

## Task Classification
- Type: [tiny-hotfix|bug|perf|feature|refactor|architecture|ui-prototype|logic-prototype|docs|hotfix]
- Scope mode: [EXPANSION|HOLD|REDUCTION]
- Required gates: [diagnosis, vertical_slices, test_seams, review]
- Phase split required: [true|false and why]
- Risk tier: [low|medium|high]
- Evidence mode: [minimal|standard|strict]
- Ceremony mode: [lean|standard|strict]

## Minimum Diff Gate
- Selected rung: [no-build|config-docs|existing-code|stdlib-native|installed-dependency|one-local-change|new-implementation]
- Higher rungs checked: [what was checked and why it did not satisfy the promise]
- Reuse targets: [existing files/APIs/native features/dependencies checked]
- New dependency allowed: [true|false and why]
- File/LOC budget: [N files / N LOC]
- Skipped complexity:
  - Item: [what is intentionally not being built]
  - Why safe now: [why the success invariant still holds]
  - Add when: [specific future signal]

## Domain Language
- [Canonical project terms from your conventions doc (CLAUDE.md / AGENTS.md), .claude/YALLA.md, docs]

## Architecture Alignment
- Source-of-truth docs: [`docs/architecture/...` — why each applies, or `N/A` with reason]
- Code sources checked: [paths]
- Alignment verdict: `aligned` | `docs-drift` | `code-drift` | `intentional-change-updates-docs`
- PRD impact: [what this plan promises relative to the architecture docs]
- Required doc updates: [paths or `none`]
- Test/review proof: [how tests and review will prove code and docs stayed aligned]

## Product Intent
- Applies: [true|false]
- Trigger: [why it applies, or N/A reason]
- Target actor: [user|buyer|customer|admin|operator|agent|reviewer]
- Desired outcome: [what becomes easier/safer/faster/more likely]
- Metric moved: [primary metric or proxy]
- Opportunity/problem: [customer pain, workflow bottleneck, strategic constraint, or risk]
- Current evidence: [data, incident, user report, support signal, sales signal, or explicit lack of evidence]
- MVP scope: [smallest user-testable implementation]
- Non-goals: [scope boundaries]

### Load-Bearing Assumptions
1. **Claim:** [claim that would kill or change the plan if false]
   - Fails if: [falsifiable condition]
   - Evidence to get this week: [specific query, call, prototype, or shipped slice]
   - Cheapest test: [smallest confidence-changing test]
   - Kill criterion: [threshold to stop, narrow, or pivot]

### Intended Behavior
- [Behavior, rule, promise, or boundary implementation must preserve]

## Research Summary
- Research artifact: [`plans/active/issue-###-[slug]-research.md` or `N/A` with reason]
- Existing patterns checked: [paths]
- External references checked: [links or `none`]
- Prior implementations/learnings reused or rejected: [summary]

## Phase PR Decision
- Phase split required: [true|false]
- Reason: [why one PR is enough, or why child phase PRs are needed]
- If split: [parent issue plus child issue/PR list, each with user-testable outcome]

## UI Design Pre-Pass
- Applies: [true|false]
- Direction: [design constraints, components, mobile behavior, references, non-goals]

## Interfaces and Test Seams
- [Public interface] — [invariants/error modes] — [highest correct test seam]

## Proof Plan
- [Acceptance criterion] — proof mode: [existing-test|new-test|playwright|static-artifact|manual-smoke|model-judge|inconclusive] — deterministic seam available: [yes/no] — evidence target: [test/artifact/command]

## Approach
[Concrete technical approach.]

## Success Invariant
[What must be true before the workflow can be marked successful.]

## Vertical Slices
### Slice 1: [demoable behavior]
Type: AFK | HITL
Blocked by: None | Slice N
User-visible outcome: [what works after this slice]
Public interface: [route/endpoint/function]
Test seam: [highest correct seam]
Acceptance criteria:
- [ ] [testable behavior]

## Incident Regression Map
- Related incidents/learnings: [paths, or "none found"]
- Failure modes this PR must not repeat
- Regression guard required

## Risk-Triggered Gates
- success-invariant-check: [always]
- async-reliability-check: [applies/N/A and why]
- schema-migration-check: [applies/N/A and why]
- identity-routing-check: [applies/N/A and why]
- payment-integrity-check: [applies/N/A and why]
- intended-vs-implemented-check: [applies/N/A and why]
- email-delivery-check: [applies/N/A and why]
- generated-artifact-check: [applies/N/A and why]
- ui-journey-check: [applies/N/A and why]
- architecture-docs-check: [applies/N/A and why]
- doc-alignment-check: [applies/N/A and why]

## Files Affected
- `path/file` — why

## Acceptance Criteria
- [ ] Testable done condition
- [ ] Negative or false-success condition

## Edge Cases
- Edge case and expected behavior

## Risks
- Risk and mitigation

## Operator Understanding
- **Problem in plain English:**
- **Why it existed:**
- **Solution in plain English:**
- **Key tradeoff:**
- **What this impacts:**
- **What could go wrong:**
- **How we verified it:**
- **Understanding depth:** light/default/deep
- **Teach-back needed:** yes/no/pending and why

## Artifact Manifest
- `.pipeline/architecture-alignment.json`
- `.pipeline/product-intent.json`
- `.pipeline/acceptance-trace.json`
- `.pipeline/progress.md`
- `.pipeline/intent-brief.md`
- `.pipeline/test-evidence.json`
- `.pipeline/review-results.json`
- `.pipeline/outcome-evaluation.json`
```

Artifact policy:

- Commit `.pipeline/*` artifacts only when they explain non-obvious decisions, accepted risks, review findings, or architecture alignment that reviewers need in the diff.
- Keep routine state artifacts local and summarize them in the PR body instead.
- Never commit `.pipeline/ship-manifest.json` solely to record the PR number or final PR check status; that evidence belongs in the PR body or comments because another commit restarts checks and makes it stale.
- For tiny-hotfix mode, prefer no committed `.pipeline/*` artifacts unless the fix needs an audit trail beyond the issue, PR body, and test output.

After user approval:

1. Update the GitHub issue body/comment with the Agent Brief from `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/AGENT-BRIEF.md`.
2. Persist the approved plan path in `.pipeline-state.json`.
3. If Product Intent applies and the intent is non-obvious or review-relevant, initialize `.pipeline/product-intent.json` with the Product Intent fields and intended behavior claims.
4. Initialize `.pipeline/acceptance-trace.json` with every acceptance criterion in `status: "pending"`, its proof mode, deterministic-seam decision, and evidence target.
5. Initialize `.pipeline/progress.md` with planned slices, accepted risks, and the next handoff note when the work is more than a tiny hotfix.

---

## Phase 2: Work

1. Create a TodoWrite checklist from the approved plan.
2. Read affected files before editing.
3. Before each phase or slice, do a scoped deep-research pass just for that unit of work:
   - Re-read the affected files and nearest tests.
   - Check current external docs only when APIs/libraries/protocols are touched.
   - Confirm the test seam is still the highest correct seam.
   - For UI slices, inspect relevant existing screens/components before coding.
   - Append decisions, failed attempts, and gotchas to `.pipeline/progress.md`.
4. Execute tracer-bullet loop from `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/VERTICAL-SLICES.md`:
   - For each slice and acceptance criterion, write or request one failing behavior test at the highest correct seam before production implementation.
   - Implement the minimum code to pass that test.
   - Run the targeted test and affected suite before moving to the next criterion.
   - Update `.pipeline/acceptance-trace.json` after each criterion.
   - Update `.pipeline/progress.md` with completed behavior, decisions made, failed attempts, and next-slice handoff.
5. If no correct seam exists, record `TEST_SEAM_BLOCKED` from `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/TEST-SEAMS.md` and halt for user decision unless the plan already accepted the risk.
6. Implement the smallest correct change. Do not implement future slices speculatively.
7. Choose the verification harness when the changed surface needs it:
   - UI behavior -> use repo-native Playwright/browser/devtools harnesses when available; capture console/network errors and screenshots or snapshots when they prove the claim.
   - CLI/TUI/script behavior -> use a deterministic local harness or transcript; clean up temporary sessions and artifacts.
   - Measurable claims -> restate the claim in falsifiable form and capture baseline/treatment evidence when feasible.
   - Core user workflows -> run or define the closest end-to-end path the user would manually check. If automation is missing, either add a focused test or record the manual-validation gap as risk.
8. Run targeted tests after each meaningful chunk.
9. Run the project's `typecheck` and `build` commands (from `.claude/YALLA.md` `commands:`) where relevant.
   - On failure, group errors by file/category before editing.
   - Fix the highest-confidence root cause first, not every visible symptom.
   - Rerun the exact failing command after each fix.
10. For `deep` understanding mode, create or update `plans/active/issue-###-understanding.md` from the protocol template. For `default`, keep the Operator Understanding plan section current.
11. Update local state to `phase: "3-test"`.

Security self-check: input validation, SQL safety, auth boundaries, CSP/sanitization, secrets.

---

## Phase 3: Test

### Tests (MANDATORY, Risk-Based)

1. Identify what changed — new pages, API endpoints, jobs, webhooks, migrations, generated artifacts, user flows.
2. Read the plan's `Architecture Alignment` section and relevant `docs/architecture/` files before writing or accepting tests.
3. Verify every acceptance criterion maps to behavior test evidence in `.pipeline/acceptance-trace.json`.
4. Verify every criterion has a proof mode and that `model-judge` is not used when a deterministic seam exists.
5. Verify every affected architecture-doc claim is covered by behavior evidence, marked unchanged with code evidence, updated in docs, or explicitly accepted as risk.
6. Write tests matching existing patterns in the project's test directory (`.claude/YALLA.md` `test_dir`).
7. Use the project's shared test setup where one exists (`.claude/YALLA.md` `test_setup_file`).
8. Place tests in the directory the project uses for that layer (API, lib, integration, components).
9. For customer-critical journeys, include at least one negative-path test for the most likely failure mode, not only happy path.
10. If a prior incident was cited in the plan, add or identify a regression guard for that exact failure mode.
11. Run the project's test command (`.claude/YALLA.md` `commands.test`) — ALL tests must pass. Fix and retest until green.
12. For user-visible, integration, CLI, performance, or memory claims, write a falsifiable verification entry in `.pipeline/test-evidence.json` with `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE` and the raw command/artifact evidence.
13. Write `.pipeline/architecture-alignment.json` when the architecture-doc gate applies.
14. Write `.pipeline/test-evidence.json` with commands, status, seam blockers, claim verification, smoke evidence, and architecture-doc alignment status when the evidence is non-obvious or needs to be committed. Otherwise summarize the same evidence in the PR body.
15. If evidence is missing, blocked, or inconclusive, set the eventual outcome to `NOT_PROVEN` or `INCONCLUSIVE`; do not call the work complete.
16. Update `.pipeline-state.json` to `phase: "4-review"`, `test_status: "passing"` only when required test commands passed. Otherwise record the blocker.

Validation evidence should be reviewer-digestible. For UI, workflow, or integration changes, include screenshots, trace links, HTTP transcripts, console/network summaries, or command output excerpts that prove the behavior without requiring the user to rerun everything.

### Automated QA (UI changes only)

Launch QA sub-agent: navigate affected pages, click buttons, submit forms, check console for errors. Record video for PR.

---

## Phase 4: Review

Before fresh-context review, write `.pipeline/intent-brief.md` when the diff is more than a tiny hotfix. The brief is what a senior reviewer needs before looking at the diff:

- Original user goal and non-goals.
- Planned behavior and success invariant.
- Risk tier: `low`, `medium`, or `high` with reason.
- Reviewer entry points and files not worth reviewing line-by-line.
- Validation evidence already collected.
- Open decisions or product implications that require human judgment.
- Product Intent summary and intended behavior claims when the product-intent gate applies.

Before binary review, run a hostile self-critique and write `.pipeline/but-for-real.md`:

- Assume the implementation is wrong in production.
- Identify 3-5 concrete failure modes the builder likely missed.
- Inspect the code and tests for each failure mode.
- Fix confirmed issues before external review; record false alarms with evidence.

Use reviewer separation wherever tooling allows it: the reviewer must not be the same agent/model context that wrote the implementation. Prefer a stricter or different model for correctness/security review after a broad implementation pass. If separation is unavailable, record that limitation in `.pipeline/review-results.json` and compensate with narrower evidence checks.

Risk-tier the review:

- `low`: docs, tests, one-line constants, or isolated changes with strong targeted evidence. Human can review summary/evidence first and inspect diff only if something smells wrong.
- `medium`: normal feature/fix touching a public interface. Human should inspect reviewer entry points, risky files, and validation artifacts.
- `high`: payments, auth, data migrations, webhook/job reliability, generated artifacts, security, broad refactors, or ambiguous product behavior. Require stricter review, explicit accepted risks, and architecture/doc alignment proof.

Run binary pass/fail checks. Universal checks stay small:

- **security-check:** Does this introduce SQL injection, XSS, SSRF, auth bypass, or exposed secrets?
- **correctness-check:** Do schemas, types, params, and downstream contracts match?
- **success-invariant-check:** For each changed workflow, can the code report success before the user-visible promise is fulfilled or before an explicit recoverable state is persisted?
- **test-quality-check:** Do tests verify behavior through the highest correct public interface, and does every acceptance criterion have evidence or an accepted risk?
- **evidence-check:** Do build/typecheck/test/smoke/claim-verification artifacts prove the stated behavior, and are `INCONCLUSIVE` results handled as risks instead of success?
- **reviewability-check:** Can a reviewer understand the intent, risky files, generated/mechanical changes, and test evidence from the PR body and artifacts without reconstructing the run?
- **documentation-impact-check:** Did the change affect docs, runbooks, examples, generated templates, API references, or architecture claims? If yes, were they updated? If no, is the no-impact reason credible?
- **intended-vs-implemented-check:** When Product Intent applies, does implementation evidence enforce the documented intent across every touched money, access, data, privacy, delivery, trust, or product-promise boundary?

For structural changes:

- **architecture-check:** Does this change respect existing patterns from your conventions doc (CLAUDE.md / AGENTS.md) and relevant `docs/architecture/` files?
- **complexity-check:** Does this add avoidable abstraction, oversized functions, or YAGNI complexity?
- **slop-check:** Are comments, casts, defensive checks, or style drift abnormal for the surrounding code?
- **architecture-depth-check:** Does this change improve or preserve module depth and locality? Are new seams justified by real adapters?
- **architecture-docs-check:** Does the PRD/plan cite the right architecture docs, does the code conform to those docs or update them in the same PR, and does `.pipeline/architecture-alignment.json` prove the verdict?
- **strict-structure-check (conditional):** For broad/high-risk diffs, is there a clear code-judo simplification that would delete complexity, avoid file-size blowups, or prevent spaghetti branching before shipping?

Risk-triggered checks:

- **async-reliability-check:** Does each async side effect define idempotency, retry taxonomy, terminal states, observability, and recovery?
- **schema-migration-check:** Do migrations, templates, writers, and schema docs stay coupled for both new and existing environments?
- **identity-routing-check:** Does auth/OAuth/invite code bind the right identity, classify roles correctly, and avoid orphan or broken-link states?
- **payment-integrity-check:** Do checkout, webhook, entitlement, coupon, invoice, and fee paths preserve money and access invariants?
- **intended-vs-implemented-check:** Does the implementation match the Product Intent, plan, architecture docs, and PR promises on the real code paths? If it differs, is the intent updated or the mismatch fixed?
- **email-delivery-check:** If an email carries the user's only token/link/instruction, is it treated as critical infrastructure with render tests, logging, retry, and recovery?
- **generated-artifact-check:** Do generated repos/templates contain no unresolved placeholders, missing manifest files, citation/markup tags, object-string leaks, or inaccessible delivery links?
- **ui-journey-check:** Can a user complete and recover from the changed form/journey on desktop and mobile, including the likely failure path?
- **architecture-docs-check:** Do `docs/architecture/*` files and code agree after this PR? If not, did the PR intentionally update one side and record proof in `.pipeline/architecture-alignment.json`?
- **doc-alignment-check:** Do docs reflect changed public APIs, routes, migrations, user flows, or operational runbooks?
- **operator-understanding-check:** Run for non-trivial work. Does the PR include the operator-readable summary/artifact required by its selected understanding depth, without requiring the operator/maintainer to read code?

Any fail blocks shipping. Each Fail must include file/line, exact code, issue, and specific fix.

After fixes, re-run ALL checks on changed files, not just the failing check. Write `.pipeline/review-results.json` before leaving review.

Run a documentation impact scan before shipping. Search only the relevant docs/examples/templates for changed public terms, routes, APIs, env vars, commands, UI labels, generated artifacts, and operational steps. Update impacted docs or record `docs-impact: none` with evidence in the PR body.

### Outcome Evaluation

After review, write `.pipeline/outcome-evaluation.json`:

```json
{
  "issue_id": "issue-###",
  "verdict": "PROVEN|NOT_PROVEN|INCONCLUSIVE",
  "issue_intent": "Concrete user-visible promise from the issue",
  "criteria_summary": [
    {
      "criterion": "...",
      "proof_mode": "existing-test|new-test|playwright|static-artifact|manual-smoke|model-judge|inconclusive",
      "status": "covered|accepted-risk|blocked",
      "evidence": "test/artifact/command path"
    }
  ],
  "remaining_delta": [],
  "human_decisions_needed": []
}
```

Verdict rules:

- `PROVEN`: every acceptance criterion is covered by valid evidence, all required review checks pass, all required commands pass, and no remaining delta exists.
- `NOT_PROVEN`: evidence or review shows the promise is not satisfied.
- `INCONCLUSIVE`: local proof is blocked or external evidence is unavailable. This must name the human decision or external proof still needed.

---

## Phase 5: Compound

Every run produces compound output.

Collect evidence: `git diff "$BASE_BRANCH" --stat`, review findings, build failures, test evidence, PR comments if this run updates an existing PR, and plan drift. Use `gh pr checks` after PR creation as external evidence in the PR body or comments, not as a reason to create another commit unless the checks reveal a real code/doc fix.

Categorize root causes:

- Planning gap
- Implementation miss
- Testing blind spot
- Tooling issue
- Artifact drift
- Product intent drift

Route durable learnings to the smallest lasting home:

- Your conventions doc (CLAUDE.md / AGENTS.md) only for global repo rules future agents must know before coding.
- `.claude/YALLA.md` for pipeline-specific defaults, gotchas, or domain mapping.
- `${CLAUDE_PLUGIN_ROOT}/knowledge/product/*` for reusable product-intent, assumption-testing, GTM, metrics, or intended-vs-implemented guidance.
- `docs/learnings/YYYY-MM-DD-[topic].md` for incident/process-specific directives.
- `.pipeline/progress.md` only for ephemeral handoff context that should not persist after the PR.

If there are learnings, write them to the selected destination with actionable directives and reference `issue-###`. If not, record a short skip reason in the compound artifact/state. Ask whether the run exposed a durable rule that would prevent the same mistake in future work. Do not update durable docs for one-off preferences or local context rot.

### Optional: durable memory store

When `.claude/YALLA.md` defines a `memory:` block with `save_enabled: true`, also persist each actionable directive to the configured store (dual-write — store plus git history), so Phase 0b can recall it on future runs:

1. Apply the directive test from `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/MEMORY-PROTOCOL.md`: a directive must be pasteable into Phase 0 and immediately change how an agent plans. If it needs interpretation, it is wisdom — discard it.
2. Write it to `docs/learnings/YYYY-MM-DD-[topic].md` (git history) **and** insert it into the store via the configured `save_tool`/`save_query`, tagging with `tags_namespace` plus the matched `domain` and `"directive"`. Reference shape:
   ```sql
   INSERT INTO memory_knowledge (title, content, tags)
   VALUES ('[directive title]', '[directive + why + file/pattern reference]',
           '{namespace + ["[domain]", "directive"]}'::jsonb);
   ```
3. If `memory:` is absent or `save_enabled` is false, this step is skipped — the `docs/learnings/` write above still applies.

Reference learnings against `issue-###`, not a parallel ID scheme.

Before committing or opening/updating the PR:

1. Inspect changed paths, generated files, mechanical changes, and behavior changes.
2. Separate reviewer entry points from supporting artifacts in the PR body.
3. Call out risky behavior changes, rollout concerns, smoke/verification evidence, and accepted risks.
4. Include a risk tier (`low`, `medium`, `high`) and why.
5. Include documentation impact status and validation artifacts or links.
6. Include the Minimum Diff summary: selected rung, skipped complexity, why safe now, and add-when signals.
7. If Product Intent applies, include the outcome, metric/proxy, MVP scope, intended-vs-implemented verdict, and any accepted product assumption risk.
8. If updating an existing PR, fetch review and discussion comments, group blocking feedback first, and address or explicitly respond to each blocker.
9. Do not rewrite history, force-push, or clean commits unless the user explicitly approves that separate action.
10. Read `.pipeline/outcome-evaluation.json`. If verdict is not `PROVEN`, PR copy must say `human review needed` or `not proven`; do not use completion language.

---

## Phase 6: Ship

### Incident Report Gate

If `.pipeline-state.json` has `is_production_fix: true` or classification is `hotfix`, verify a same-day `docs/incidents/YYYY-MM-DD-*.md` exists before shipping. If not, halt and ask the user to run `/incident`.

### Commit and PR

Commit specific files only:

```bash
git commit -m "feat(scope): [description]

Issue: issue-###
Co-Authored-By: Claude <noreply@anthropic.com>"
```

Push and open PR:

```bash
git push -u origin "session/issue-$ISSUE_NUMBER-$SLUG"
gh pr create \
  --head "session/issue-$ISSUE_NUMBER-$SLUG" \
  --base "$BASE_BRANCH" \
  --title "[issue-$ISSUE_NUMBER] [description]" \
  --body "$(cat <<EOF
## Summary
[What changed]

## Non-Engineer Summary
What changed:
Why it matters:
Who is affected:
What could go wrong:
How we tested it:
Decision needed from the operator/maintainer:

## Risk Tier
[low|medium|high] - [why]

## Minimum Diff
- Selected rung: [no-build|config-docs|existing-code|stdlib-native|installed-dependency|one-local-change|new-implementation]
- Skipped complexity: [what we deliberately did not build]
- Why safe now: [why the success invariant still holds]
- Add when: [specific signal for expanding scope]

## Product Intent
- Applies: [true|false and why]
- Outcome/metric: [desired outcome + metric/proxy]
- MVP scope: [smallest shipped slice]
- Intended-vs-implemented: [Pass/N/A/accepted risk]

## Reviewer Entry Points
- [files/flows worth human attention]

## Validation Evidence
- [commands, screenshots, traces, transcripts, or accepted gaps]

## Documentation Impact
- [updated docs or no-impact reason]

## Outcome
- Verdict: [PROVEN|NOT_PROVEN|INCONCLUSIVE]
- Remaining delta: [none or explicit blockers]
- Human decisions needed: [none or explicit decisions]

## Review Checks
- [x] security-check: Pass
- [x] complexity-check: Pass
- [x] operator-understanding-check: Pass
- [x] intended-vs-implemented-check: Pass [or N/A with reason]
- [x] success-invariant-check: Pass
- [x] behavior tests passing through public seams
- [x] test-quality-check: Pass

## Merge Policy
- pr-only by default. Auto-merge only if explicitly approved in this run.

Refs #$ISSUE_NUMBER
EOF
)"
```

Comment on the issue with the PR URL and move status label to `status/review` if GitHub will not auto-close on merge. Use `Refs`, not `Closes`, for PRs targeting a non-default `$BASE_BRANCH`; use `Closes` only when `$BASE_BRANCH` is the repo default branch.

After creating or updating the PR, run `gh pr checks --json name,bucket,state,workflow,link` and use that as the source of truth for PR-attached checks.

- If checks are pending, use `gh pr checks --watch --fail-fast` when appropriate.
- If checks fail, inspect the failed job/link, fix one actionable root cause, push, and re-check the full set.
- If a failure is flaky, retry once and record flake evidence.
- If a failure is unrelated to this PR, document the evidence instead of bloating the PR with unrelated fixes.

Write `.pipeline/ship-manifest.json` only if it will be committed as meaningful review evidence before PR creation, or keep it local. Do not push a follow-up commit just to add PR number or check status; put that in the PR body/comment instead.

If `.pipeline/outcome-evaluation.json` is missing, halt before PR creation. If its verdict is not `PROVEN`, PR creation is allowed only when the PR body clearly labels the run as not proven and names the remaining delta.

Merge only if `.pipeline-state.json` has `merge_policy: "auto-merge-approved"` from an explicit user request in this run. Otherwise stop after PR creation and report the PR URL.

---

## Recovery

1. Read local state for `issue_number`, branch, phase, classification, and merge policy.
2. Read `plans/active/issue-###-[slug].md`.
3. Read the GitHub issue body/comments for durable context.
4. Read `.pipeline/acceptance-trace.json`, `.pipeline/architecture-alignment.json`, `.pipeline/test-evidence.json`, and `.pipeline/review-results.json` if present.
5. Read `.pipeline/outcome-evaluation.json` if present.
6. Resume from the recorded phase.

---

## Interruption Handling

- **"stop"** -> Pause after current step, show progress.
- **"skip to [phase]"** -> Jump to specified phase.
- **"status"** -> Show current phase + progress.

---

## Anti-Patterns

- Inventing a parallel task-ID scheme instead of using `issue-###`.
- Bypassing GitHub Issues as the canonical task store.
- Planning without reading the codebase.
- Letting research become months of planning instead of a short path to the next user-testable PR.
- Shipping without tests/review.
- Reusing a session branch for unrelated work.
- Keeping broad multi-surface work in one PR when phase PRs would be easier to test, review, ship, and roll back.
- Launching parallel implementation agents from a known-red base without first fixing/rebasing the shared blocker.
- Committing PR check status artifacts after PR creation and restarting CI just to update evidence.
- Forcing full pipeline artifacts into a tiny hotfix where reproduce/fix/verify evidence is enough.
- Fixing a bug before reproducing the user-reported symptom.
- Writing implementation before a failing behavior test or an approved `TEST_SEAM_BLOCKED` exception exists.
- Creating shallow tests that mock internal modules just to satisfy the test gate.
- Introducing seams with only one adapter and no real variation.
- Auto-merging a PR without explicit user approval in this run.
- Treating `gh run list` as the complete PR status instead of `gh pr checks`.
- Claiming a fix is verified without a falsifiable claim and evidence.
- Shipping a PR whose body does not explain review entry points, risks, and test evidence.
- Shipping product/GTM/user-flow work without a Product Intent section or a specific N/A reason.
- Treating intended-vs-implemented-check as generic doc alignment instead of comparing documented intent to real implementation evidence.
- Shipping without a documentation impact scan when public behavior, APIs, runbooks, generated artifacts, or UI copy changed.
- Asking the user to review a broad diff without an intent brief, risk tier, and validation artifacts.
- Letting conflict resolution become a refactor.
- Reviewing your own code (author != reviewer), including reviewing a refactor you just did during the review phase.
- Prefixing a parameter with `_` to suppress unused-var lint instead of removing it.
