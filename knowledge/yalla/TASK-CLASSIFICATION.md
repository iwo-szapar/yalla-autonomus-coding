# Yalla Task Classification

Every `/yalla` run classifies the task immediately after preflight and before planning. Classification chooses the smallest safe engineering path, required gates, evidence mode, and merge policy.

## Output

Write the classification into `.pipeline/classification.json` and `.pipeline-state.json`:

```json
{
  "issue_id": "issue-###",
  "task_type": "bug|perf|feature|refactor|architecture|ui-prototype|logic-prototype|docs|hotfix|tiny-hotfix",
  "scope_mode": "EXPANSION|HOLD|REDUCTION",
  "required_gates": ["diagnosis", "architecture-depth", "vertical_slices", "test_seams", "review"],
  "phase_split_required": false,
  "risk_tier": "low|medium|high",
  "evidence_mode": "minimal|standard|strict",
  "ceremony_mode": "lean|standard|strict",
  "minimum_diff_decision": {
    "selected_rung": "no-build|config-docs|existing-code|stdlib-native|installed-dependency|one-local-change|new-implementation",
    "why_higher_rungs_failed": ["..."],
    "reuse_targets": ["..."],
    "new_dependency_allowed": false,
    "files_budget": 3,
    "loc_budget": 120,
    "skipped_complexity": [
      {
        "item": "...",
        "why_safe_to_skip": "...",
        "add_when": "..."
      }
    ]
  },
  "product_intent_gate": "applies|n/a",
  "product_intent_gate_reason": "...",
  "architecture_doc_gate": "applies|n/a",
  "architecture_doc_gate_reason": "...",
  "base_branch": "main",
  "merge_policy": "pr-only|auto-merge-approved"
}
```

`base_branch` mirrors `$BASE_BRANCH` from `.claude/YALLA.md` (default `main`).

## Routing Rules

- `tiny-hotfix`: one-file or one-value fix with clear expected behavior and low blast radius. Use minimal evidence mode.
- `bug`, `fix`, `broken`, `error`, `crash`, `failing`, `regression`: `bug` with diagnosis gate.
- `slow`, `latency`, `timeout`, `performance`, `memory`: `perf` with diagnosis and measurement gates.
- `new page`, `new flow`, `new API`, `greenfield`: `feature` with vertical slices.
- `refactor`, `cleanup`, `simplify`: `refactor` with architecture-depth review.
- `architecture`, `seam`, `module`, `testability`, `coupling`: `architecture` with `architecture-depth` analysis before code.
- `prototype`, `try designs`, `what should this look like`: `ui-prototype` unless the question is state/data logic.
- `state machine`, `data model`, `logic prototype`, `let me play with states`: `logic-prototype`.
- `hotfix`, `urgent`, `production down`, `security vulnerability`: `hotfix` with REDUCTION mode, diagnosis gate, and incident gate.
- `docs`, `copy`, `README`, `runbook`: `docs` unless the docs change a public contract that also requires code/test alignment.

## Product Intent Gate

Set `product_intent_gate: "applies"` when the task changes product/GTM/user-flow behavior, pricing/packaging, onboarding promises, access/delivery boundaries, metrics, or copy that makes a user-visible promise.

Set `product_intent_gate: "n/a"` only with a concrete reason, such as `internal refactor preserving public behavior` or `test-only change with no product promise change`.

When the gate applies, the plan must include `Product Intent`, approval must preserve the MVP boundary, and review must run `intended-vs-implemented-check`.

If more than one type matches, choose the riskiest applicable path:

1. `hotfix`
2. `bug` / `perf`
3. `architecture`
4. `ui-prototype` / `logic-prototype`
5. `feature`
6. `refactor`
7. `docs`
8. `tiny-hotfix` only when its constraints are truly met. If a one-file/one-value fix clearly satisfies tiny-hotfix constraints, prefer `tiny-hotfix` over the generic `bug` route even when the title contains words like `fix` or `failing`.

## Scope Mode

- `EXPANSION`: greenfield features where a better durable shape is worth extra work.
- `HOLD`: default for explicit tasks, bug fixes, and refactors. Execute exactly the approved plan.
- `REDUCTION`: hotfixes, tiny hotfixes, or very broad diffs. Ship the smallest safe correction.

Re-classify only after user approval or a blocker that invalidates the plan.

## Phase Split

Set `phase_split_required: true` when the work spans multiple product surfaces that cannot ship/test/rollback as one coherent user-visible change, multiple risky subsystems, more than two meaningful user-visible slices, or cannot be manually tested/reviewed/rolled back as one coherent change.

Set `false` only when one PR can remain independently shippable, reviewable, and rollbackable.

## Risk Tier

- `low`: docs, tests, constants, or isolated code with strong targeted evidence and low blast radius.
- `medium`: normal feature/fix touching a public interface or user/operator workflow.
- `high`: payments, auth, data migrations, webhook/job reliability, generated artifacts, security-sensitive behavior, broad refactors, or ambiguous product behavior.

## Evidence Mode

- `minimal`: tiny-hotfix or docs-only work. PR body includes reproduce/fix/verify evidence; committed `.pipeline/*` artifacts are usually unnecessary.
- `standard`: default. Local `.pipeline/*` artifacts guide the run; commit only artifacts that are useful for review.
- `strict`: high-risk work. Use intent brief, hostile self-critique, acceptance trace, test evidence, and architecture alignment proof where applicable.

## Ceremony Mode

- `lean`: user invoked `/yalla lean ...`, the task is tiny/minimal, or the minimum-diff gate selected `no-build`, `config-docs`, `existing-code`, `stdlib-native`, `installed-dependency`, or `one-local-change` with low risk. Lean changes artifact volume, not proof honesty.
- `standard`: default adaptive pipeline for normal feature/fix work.
- `strict`: user invoked `/yalla strict ...`, risk is high, or proof requires strict evidence artifacts and stricter review separation.

## Minimum Diff Decision

Run `knowledge/yalla/MINIMUM-DIFF.md` before planning. Classification must record the selected rung, higher rungs checked, reuse targets, whether a new dependency is allowed, file/LOC budget, and skipped complexity with `why_safe_to_skip` plus `add_when`.

If a task can be satisfied by `no-build`, `config-docs`, or `existing-code`, prefer that route and do not create implementation scope just to exercise the pipeline. If the task requires `new-implementation`, the plan must name why existing code, stdlib/native, and installed dependencies do not satisfy the promise.

## Architecture Doc Gate

Set `architecture_doc_gate: "applies"` when the task changes behavior described in your architecture docs, including routes, auth, API endpoints, tools, generation paths, checkout/payment flows, onboarding flows, data boundaries, schema behavior, generated artifacts, or ingestion flows.

Set `architecture_doc_gate: "n/a"` only with a short reason, such as `test-only change with no documented behavior change` or `copy edit outside architecture docs`.

When the gate applies, the plan must include `Architecture Alignment`, validation must cover the affected claims, and review must run `architecture-docs-check`.

## Default Merge Policy

Default is `pr-only`. Set `auto-merge-approved` only if the user explicitly asked for merge/automerge in this run.
