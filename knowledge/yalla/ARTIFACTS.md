# Yalla Artifacts

Machine-readable artifacts let `/yalla-review` and `/yalla-audit` verify the run instead of trusting prose. They are evidence schemas, not a mandate to commit every file on every PR.

Store artifacts under `.pipeline/` during active runs. Commit artifacts only when they explain non-obvious decisions, accepted risks, architecture alignment, or review findings that reviewers need in the diff. Keep routine state local and summarize it in the PR body.

Do not commit a follow-up artifact update just to record the PR number or final PR check status. PR check evidence belongs in the PR body or PR comments because another commit restarts checks and makes committed CI status stale.

Tiny hotfixes may use minimal evidence mode: no committed `.pipeline/*` artifacts when the PR body contains reproduce/fix/verify evidence and the diff is self-evident.

## Artifact Policy

- `minimal`: PR body or issue comment is enough unless the decision is non-obvious.
- `standard`: create local artifacts as needed; commit only review-relevant artifacts.
- `strict`: high-risk work should include review-relevant artifacts or PR body sections for intent, risk, acceptance trace, test evidence, and architecture alignment.

## Schemas

### `.pipeline/classification.json`

```json
{
  "issue_id": "issue-###",
  "task_type": "feature",
  "scope_mode": "HOLD",
  "required_gates": ["vertical_slices", "test_seams"],
  "phase_split_required": false,
  "risk_tier": "medium",
  "evidence_mode": "standard",
  "product_intent_gate": "applies|n/a",
  "product_intent_gate_reason": "Changed onboarding copy and delivery behavior",
  "architecture_doc_gate": "applies|n/a",
  "architecture_doc_gate_reason": "Changed the payment success flow documented in docs/architecture/flows.md",
  "external_grounding_gate": "applies|n/a",
  "external_grounding_gate_reason": "Uses provider retry semantics",
  "runtime_e2e_gate": "applies|n/a",
  "runtime_e2e_gate_reason": "PR claims preview-environment evidence",
  "merge_policy": "pr-only"
}
```

### `plans/active/issue-###.plan.json`

```json
{
  "issue_id": "issue-###",
  "title": "...",
  "task_type": "feature",
  "phase_split_required": false,
  "risk_tier": "medium",
  "evidence_mode": "standard",
  "domain_terms": ["Order", "Invoice"],
  "architecture_docs": [
    {
      "path": "docs/architecture/flows.md",
      "reason": "Changed the payment success flow",
      "verdict": "intentional-change-updates-docs"
    }
  ],
  "interfaces": [
    {"name": "POST /api/foo", "kind": "http", "invariants": ["auth required"]}
  ],
  "vertical_slices": [
    {
      "id": "slice-1",
      "title": "...",
      "type": "AFK",
      "test_seam": "api endpoint",
      "acceptance_criteria": ["..."]
    }
  ],
  "risks": [
    {"risk": "...", "resolution": "mitigated|accepted|user-decision"}
  ],
  "evidence_gates": {
    "surface_parity": "applies|n/a",
    "trust_map": "applies|n/a",
    "volume_envelope": "applies|n/a",
    "lifecycle_states": "applies|n/a",
    "ui_proof": "applies|n/a"
  }
}
```

### `.pipeline/architecture-alignment.json`

Required when the task changes behavior described by `docs/architecture/*`, or when the plan's architecture-doc gate applies.

```json
{
  "issue_id": "issue-###",
  "verdict": "aligned|docs-drift|code-drift|intentional-change-updates-docs|accepted-risk",
  "docs_checked": [
    {"path": "docs/architecture/flows.md", "reason": "Payment flow changed"}
  ],
  "code_checked": ["api/checkout/create-session.ts", "src/pages/CheckoutSuccess.tsx"],
  "docs_updated": ["docs/architecture/flows.md"],
  "evidence": [
    {
      "claim": "Success page routes paid orders to the onboarding flow",
      "status": "covered|unchanged|accepted-risk",
      "proof": "tests/integration/checkout-success.test.ts"
    }
  ],
  "accepted_risks": []
}
```

### `.pipeline/product-intent.json`

Required when Product Intent applies and the intent is non-obvious, review-relevant, or changes money, access, data, privacy, delivery, trust, or product-promise boundaries.

```json
{
  "issue_id": "issue-###",
  "applies": true,
  "intended_outcome": "User can complete the changed onboarding step without support",
  "target_user_context": "New customer using the flow for the first time",
  "metric_or_proxy": "Completion event emitted after the recoverable state is persisted",
  "mvp_boundary": "Only the existing onboarding route changes; no new admin workflow",
  "kill_assumptions": [
    {
      "assumption": "Existing users can retry after validation errors",
      "validation": "integration test covers invalid then valid submit",
      "status": "validated|accepted-risk|blocked"
    }
  ],
  "intended_behavior_claims": [
    {
      "claim": "Invalid input never reports success",
      "evidence": "tests/onboarding-flow.test.ts",
      "status": "covered|accepted-risk|blocked"
    }
  ],
  "intended_vs_implemented_verdict": "pass|fail|accepted-risk|pending"
}
```

### `.pipeline/acceptance-trace.json`

```json
{
  "issue_id": "issue-###",
  "criteria": [
    {
      "criterion": "User can do X",
      "slice": "slice-1",
      "proof_mode": "existing-test|new-test|playwright|static-artifact|manual-smoke|model-judge|inconclusive",
      "deterministic_seam_available": true,
      "test": "tests/api/foo.test.ts",
      "status": "covered|accepted-risk|blocked",
      "evidence": "<test command> tests/api/foo.test.ts",
      "boundary_proof": {
        "required": true,
        "seam": "POST /api/foo",
        "false_success_condition": "A unit-only assertion could pass while the endpoint accepts an unauthorized caller",
        "status": "covered|not-proven|n/a"
      }
    }
  ]
}
```

For medium/high-risk criteria, set `boundary_proof.required` when a local or mocked check could falsely report the user-visible promise as successful. A `covered` criterion must then have `boundary_proof.status: "covered"`.

### `.pipeline/external-grounding.json`

Required when implementation relies on external API, SDK, protocol, provider/platform/browser behavior, or generated setup instructions. Do not put secrets in this artifact.

```json
{
  "applies": true,
  "trigger": "Provider retry semantics determine the job retry policy",
  "verdict": "grounded|inconclusive|n/a",
  "sources_checked": [
    {
      "source_type": "official-docs|upstream-source|standards|local-contract",
      "name": "Provider API retry guide",
      "url_or_path": "https://provider.example/docs/retries",
      "accessed_at": "2026-09-03",
      "claims": ["429 responses are retryable; ordinary 4xx responses are not"]
    }
  ],
  "implementation_effects": ["Retry 429 and 5xx with bounded backoff"],
  "missing_evidence": []
}
```

`inconclusive` grounding cannot support `PROVEN` for a behavior that depends on it.

### `.pipeline/runtime-e2e-preflight.json`

Required before a run claims preview, staging, production, remote, or another real-environment proof. Record only safe environment shape, never credential values or customer data.

```json
{
  "applies": true,
  "environment": "preview",
  "base_ref": "main@abc123",
  "required_shape": ["test account present"],
  "mutation_guardrails": ["No production writes"],
  "skip_classification": "none|intentional-guard-skip|unresolved-proof-gap",
  "inherited_base_failures": [],
  "proves": ["Preview route renders the provider retry error"],
  "does_not_prove": ["A production payment completes"],
  "status": "pass|blocked|n/a"
}
```

An `unresolved-proof-gap` means the corresponding promise cannot be marked `PROVEN`. An intentional guard skip is valid only when the skipped behavior is excluded from the PR promise.

### `.pipeline/progress.md`

Markdown handoff artifact for cold worktree resumes and phase PR handoffs. Keep it concise and ephemeral; promote only durable rules to your project's conventions doc (`CLAUDE.md` / `AGENTS.md`), `.claude/YALLA.md`, or `docs/learnings/*` during Compound.

```markdown
# issue-### Progress

## Completed
- [User-visible behavior, slice, or phase completed]

## Decisions
- [Decision] - [reason]

## Failed Attempts
- [Attempt] - [why it failed or was abandoned]

## Gotchas
- [Repo, tool, API, or workflow gotcha future phases need]

## Next Handoff
- [Exact next action for a fresh worktree]
```

### `.pipeline/but-for-real.md`

Hostile self-critique before binary review. Required for strict evidence mode, optional for tiny hotfixes.

```markdown
# issue-### But-For-Real Review

## Failure Modes Checked

1. [Concrete way this could fail in production]
   - Result: Confirmed and fixed | False alarm | Accepted risk
   - Evidence: [code/test/artifact]
```

### `.pipeline/intent-brief.md`

Markdown brief for fresh-context review. Required for non-tiny medium/high-risk changes when reviewer separation is used; optional for tiny hotfixes.

```markdown
# issue-### Intent Brief

## Goal
- [Original user goal and non-goals]

## Success Invariant
- [What must be true before success can be claimed]

## Risk Tier
- [low|medium|high] - [why]

## Reviewer Entry Points
- [Files/flows worth human attention]

## Product Intent
- [Outcome, metric/proxy, MVP boundary, and intended-vs-implemented verdict when the gate applies]

## Validation Evidence
- [Commands, screenshots, traces, transcripts, or accepted gaps]

## Open Decisions
- [Human judgment needed, or none]
```

Every run must include at least one negative, failure-path, or false-success criterion. Do not use `model-judge` when a deterministic seam can prove the behavior.

### `.pipeline/test-evidence.json`

```json
{
  "issue_id": "issue-###",
  "commands": [
    {"command": "<test command>", "status": "pass", "summary": "..."},
    {"command": "<typecheck command>", "status": "pass", "summary": "..."},
    {"command": "<build command>", "status": "pass", "summary": "..."}
  ],
  "claim_verification": [
    {
      "claim": "Checkout rejects expired discount codes with 400",
      "verdict": "VERIFIED|NOT VERIFIED|INCONCLUSIVE",
      "baseline": "optional before evidence",
      "treatment": "optional after evidence",
      "evidence": "command, screenshot, transcript, HTTP response, trace, or profile path",
      "risk": "required when verdict is NOT VERIFIED or INCONCLUSIVE"
    }
  ],
  "smoke_evidence": [
    {
      "surface": "ui|cli|api|integration|performance|memory",
      "harness": "repo-native browser harness, devtools, tmux transcript, local HTTP request, etc.",
      "status": "pass|fail|blocked",
      "artifact": "path or inline summary"
    }
  ],
  "ci_evidence": {
    "source": "gh pr checks",
    "status": "pass|fail|pending|n/a",
    "summary": "PR-attached check state, if a PR exists"
  },
  "architecture_alignment": {
    "status": "pass|n/a|blocked|accepted-risk",
    "artifact": ".pipeline/architecture-alignment.json",
    "summary": "docs/architecture/flows.md updated and covered by checkout success tests"
  },
  "seam_blockers": []
}
```

### `.pipeline/review-results.json`

```json
{
  "issue_id": "issue-###",
  "base": "main",
  "checks": [
    {"name": "security-check", "verdict": "pass", "reviewer": "security-reviewer"},
    {"name": "architecture-depth-check", "verdict": "fail", "findings": ["..."]},
    {"name": "evidence-check", "verdict": "pass", "reviewer": "evidence-reviewer"},
    {"name": "reviewability-check", "verdict": "pass", "reviewer": "reviewability-reviewer"}
  ],
  "pr_reviewability": {
    "status": "pass|fail|n/a",
    "entry_points": ["src/pages/Foo.tsx", "api/bar.ts"],
    "risk_notes": ["..."],
    "ci_source": "gh pr checks|n/a"
  }
}
```

### `.pipeline/outcome-evaluation.json`

Required before shipping. This is the final proof-contract artifact that decides whether the run can be called successful.

```json
{
  "issue_id": "issue-###",
  "verdict": "PROVEN|NOT_PROVEN|INCONCLUSIVE",
  "issue_intent": "Concrete user-visible promise from the unit of work",
  "criteria_summary": [
    {
      "criterion": "User can do X",
      "proof_mode": "existing-test|new-test|playwright|static-artifact|manual-smoke|model-judge|inconclusive",
      "status": "covered|accepted-risk|blocked",
      "evidence": "tests/api/foo.test.ts and <test command> tests/api/foo.test.ts"
    }
  ],
  "remaining_delta": [],
  "human_decisions_needed": []
}
```

Verdict rules:

- `PROVEN` requires every acceptance criterion to be covered by valid evidence, every required review check to pass, all required commands to pass, and no remaining delta.
- `NOT_PROVEN` means evidence or review disproves the issue promise.
- `INCONCLUSIVE` means proof is blocked or external evidence is unavailable. It does not count as complete or safe for autopilot progression.

### Autopilot State Artifacts

Autopilot state is local by default and should not be committed unless it explains a review decision or the repo intentionally audits loop state in git. See `docs/autopilot/` for the operating model.

- `.pipeline/autopilot-state.json` records selected issue, lock owner, level, mode, and last safe checkpoint.
- `.pipeline/loop-telemetry.json` records command status, timings, proof verdicts, budget usage, and stop reasons.
- `.pipeline/run-log.jsonl` is append-only per-attempt history for scheduled loops.
- `.pipeline/token-budget.json` records soft and hard budget limits for unattended loops.

Any autopilot artifact that reports `NOT_PROVEN`, `INCONCLUSIVE`, exhausted budget, failed review, ambiguous auth, or active kill switch must stop progression instead of opening or advancing work as successful.

### `.pipeline/ship-manifest.json`

```json
{
  "issue_id": "issue-###",
  "branch": "session/issue-###-slug",
  "pr": 123,
  "merge_policy": "pr-only",
  "docs_updated": true,
  "incident_required": false,
  "ci_status": "pass|fail|pending|not-run|n/a",
  "reviewability_status": "pass|fail",
  "artifacts": ["plans/active/issue-###.plan.json", ".pipeline/review-results.json"]
}
```
