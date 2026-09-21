# Yalla Artifacts

Machine-readable artifacts let `/yalla-review` and `/yalla-audit` verify the run instead of trusting prose. They are evidence schemas, not a mandate to commit every file on every PR.

Store artifacts under one issue/run namespace during active runs, for example `<run-state> = .pipeline/runs/issue-123/attempt-1`. Pass the exact `--pipeline-dir <run-state> --issue-id <issue-id> --run-id <run-id>` triple to every stateful control command. Commit artifacts only when they explain non-obvious decisions, accepted risks, architecture alignment, or review findings that reviewers need in the diff. Keep routine state local and summarize it in the PR body. Root `.pipeline/*` examples from older releases are manual, read-only legacy evidence and cannot be selected for a run.

Do not commit a follow-up artifact update just to record the PR number or final PR check status. PR check evidence belongs in the PR body or PR comments because another commit restarts checks and makes committed CI status stale.

Tiny hotfixes may use minimal evidence mode: no committed run-state artifacts when the PR body contains reproduce/fix/verify evidence and the diff is self-evident.

## Artifact Policy

- `minimal`: PR body or issue comment is enough unless the decision is non-obvious.
- `standard`: create local artifacts as needed; commit only review-relevant artifacts.
- `strict`: high-risk work should include review-relevant artifacts or PR body sections for intent, risk, acceptance trace, test evidence, and architecture alignment.

## Schemas

### Candidate binding and common envelope

Before final-head testing or review, run:

```bash
npm run yalla:run -- candidate --pipeline-dir <run-state> --issue-id issue-### --run-id <stable-run-id>
```

`<run-state>/candidate.json` binds the run namespace and repository/worktree/branch identity,
base and head SHAs, working-tree fingerprint, contract digest, Yalla config
digest, trust-policy digest, schema version, and Yalla version. Source, contract,
configuration, or policy drift creates a new candidate; prior proof is stale.

Runner-managed artifacts carry `_meta`:

```json
{
  "_meta": {
    "schema_version": 2,
    "yalla_version": "1.4.1",
    "producer": "yalla-run:evaluate",
    "produced_at": "2026-09-20T12:00:00.000Z",
    "candidate_id": "sha256...",
    "candidate_sha": "git-sha",
    "contract_digest": "sha256...",
    "config_digest": "sha256...",
    "policy_digest": "sha256...",
    "input_digests": {},
    "content_digest": "sha256...",
    "binding_digest": "sha256(content plus immutable metadata)"
  }
}
```

After writing a manual JSON proof artifact such as acceptance trace, review
results, or outcome evaluation, bind it to the current candidate:

```bash
npm run yalla:run -- stamp --pipeline-dir <run-state> --issue-id <issue-id> --run-id <run-id> --target <run-state>/outcome-evaluation.json
```

The binding digest covers both content and metadata, including the complete dependency map. Removing or replacing dependency digests after stamping makes the artifact stale. An unbound legacy artifact remains inspectable, but it cannot support an exact
resume, evaluator decision, loop continuation, or `PROVEN`. `stamp` records the
default dependency chain for acceptance, test, review, and outcome artifacts;
use repeated `--input <run-state>/<dependency>.json` arguments for additional
inputs whose changes must invalidate the stamped result.

`PROVEN` binding is fail-closed: classification, baseline, acceptance trace,
test evidence, and review results must already exist, be current for the
candidate, and satisfy their semantic pass rules. Acceptance must exactly cover
the goal contract, goal-required commands must appear in passing test evidence,
and final required checks/evidence-gate decisions must preserve classification.
A bare verdict field is never proof.

### `<run-state>/baseline.json`

Capture inherited failures before candidate repair work:

```bash
npm run yalla:run -- baseline --pipeline-dir <run-state> --issue-id <issue-id> --run-id <run-id> --finding "existing failing check and evidence"
```

Do not copy an unrelated baseline repair into the candidate. Link a separate
issue/PR and classify the evaluator result as `BASELINE_FAILURE`.

### Failure taxonomy

| Class | Loop action |
| --- | --- |
| `CANDIDATE_FAILURE` | Repair the candidate and mint/revalidate the next exact candidate. |
| `BASELINE_FAILURE` | Stop and separate the inherited repair. |
| `INFRA_ERROR` | Retry the same immutable candidate within budget. |
| `IDENTITY_MISMATCH` | Stop; resolve repository/worktree/branch identity. |
| `POLICY_BLOCKED` | Stop; obtain explicit capability or narrow the action. |
| `SUPERSEDED` | Discard the result; it belongs to an older candidate. |

### Operation and remote-job receipts

For T1/T2 remote work, the repository adapter declares the immutable provider
identity and the preflight contract an external operator-controlled executor
must verify:

```json
{
  "candidate_id": "sha256...",
  "project_identity": {
    "repository": "owner/repository",
    "project_id": "immutable-provider-project-id",
    "team_id": "immutable-provider-team-id",
    "target": "production-candidate"
  },
  "command": "npm run release:preflight",
  "status": "pass",
  "executed_at": "2026-09-20T12:00:00.000Z",
  "evidence_ref": "<run-state>/preflight-output.json"
}
```

The local `npm run yalla:run -- preflight` command always returns
`POLICY_BLOCKED`; it never executes a repository-supplied command. An external
executor may produce equivalent evidence in its own trusted store, but local
`<run-state>/release-preflight.json` and `<run-state>/preflight-output.json` files
are non-authoritative and cannot be stamped into local proof. The external
executor must independently reject missing, stale, failed, or
identity-mismatched evidence before doing consequential work.

`<run-state>/operation-receipts.json` records non-protected local actions by
operation ID, candidate, capability, action, and target before execution, then
records `succeeded` or `failed`. Reusing a pending or terminal ID is a no-op;
changing its scope is an error. The local runner refuses to reserve every
protected capability. An external controller may mirror a protected operation
as a pending receipt for observability with
`execution_authority: none-local-telemetry-only`; routine locally authorized
receipts use `local-configured-capability`. A missing or mismatched authority
class fails closed. The telemetry-only record is never approval or execution
authority. The local runner may only close an already-existing
receipt with the same operation ID/scope; it can do so after candidate drift so
the real outcome does not remain pending.

`<run-state>/remote-jobs.json` reserves a local telemetry budget before a focused
check, full suite, preview/production build, or smoke run starts. Every new
record carries `execution_authority: none-local-telemetry-only`; an external
executor must never consume it as a command. Completion records success/fail,
duration, build-versus-reuse, retry reason, and known cost. Blocked attempts are
retained. Reservations require a valid release adapter whose repository matches
the exact candidate. Completion can be recorded after candidate drift. A
`reused` artifact counts as a remote job but not as another full-suite or
production-build execution.

### `<run-state>/path-ownership.json`

Only parallel team runs need path claims:

```json
{
  "claims": [
    { "owner": "implementer", "paths": ["src/api"], "changed_paths": ["src/api/checkout.ts"] },
    { "owner": "tester", "paths": ["tests/api"], "changed_paths": ["tests/api/checkout.test.ts"] }
  ]
}
```

Run `npm run yalla:run -- ownership --pipeline-dir <run-state> --issue-id <issue-id> --run-id <run-id>`. Claims must be canonical repository-relative
paths: aliases, absolute paths, escapes, and symlinks outside the repository are
rejected. Each `changed_paths` entry must be inside that same owner's claim.
Parallel runs require per-owner changed-path evidence, and any unattributed,
false, multiply attributed, overlapping, or globally unowned change returns
`CONFLICT`. This is a coordination check, not a rigid lock on ordinary
single-agent work.

### `<run-state>/classification.json`

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
  "evidence_gate_requirements": {
    "surface_parity": { "status": "applies|n/a", "reason": "Adds a public API route" },
    "trust_map": { "status": "applies|n/a", "reason": "Consumes an untrusted display name" },
    "volume_envelope": { "status": "applies|n/a", "reason": "Makes one provider call per record" },
    "lifecycle_states": { "status": "applies|n/a", "reason": "Consumes provider job states" },
    "ui_proof": { "status": "applies|n/a", "reason": "Changes a user-visible error state" }
  },
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
    "surface_parity": { "status": "applies|n/a", "reason": "..." },
    "trust_map": { "status": "applies|n/a", "reason": "..." },
    "volume_envelope": { "status": "applies|n/a", "reason": "..." },
    "lifecycle_states": { "status": "applies|n/a", "reason": "..." },
    "ui_proof": { "status": "applies|n/a", "reason": "..." }
  }
}
```

### `<run-state>/architecture-alignment.json`

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

### `<run-state>/product-intent.json`

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

### `<run-state>/acceptance-trace.json`

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

### `<run-state>/external-grounding.json`

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

### `<run-state>/runtime-e2e-preflight.json`

Required before a run claims preview, staging, production, remote, or another real-environment proof. Record only safe environment shape, never credential values or customer data.

```json
{
  "applies": true,
  "environment": "preview",
  "base_ref": "main@abc123",
  "target_ref": "preview@def456",
  "required_shape": ["test account present"],
  "mutation_guardrails": ["No production writes"],
  "skip_classification": "none|intentional-guard-skip|unresolved-proof-gap",
  "inherited_base_failures": [],
  "proves": ["Preview route renders the provider retry error"],
  "does_not_prove": ["A production payment completes"],
  "status": "pass|blocked|n/a"
}
```

`base_ref` and `target_ref` use `<target>@<revision>` and must identify the immutable base and deployed target revision being exercised. An `unresolved-proof-gap` or any status other than `pass` means the corresponding promise cannot be marked `PROVEN`. An intentional guard skip is valid only when `does_not_prove` names the skipped behavior and that behavior is excluded from the PR promise.

### `<run-state>/progress.md`

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

### `<run-state>/but-for-real.md`

Hostile self-critique before binary review. Required for strict evidence mode, optional for tiny hotfixes.

```markdown
# issue-### But-For-Real Review

## Failure Modes Checked

1. [Concrete way this could fail in production]
   - Result: Confirmed and fixed | False alarm | Accepted risk
   - Evidence: [code/test/artifact]
```

### `<run-state>/intent-brief.md`

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

### `<run-state>/test-evidence.json`

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
    "artifact": "<run-state>/architecture-alignment.json",
    "summary": "docs/architecture/flows.md updated and covered by checkout success tests"
  },
  "seam_blockers": []
}
```

### `<run-state>/review-results.json`

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

### `<run-state>/outcome-evaluation.json`

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

- `PROVEN` requires every acceptance criterion to be covered by valid evidence, the persisted classification `required_gates` to remain a subset of final required review checks, an applicable or concrete N/A decision for every portable evidence gate, every required review check to pass, all required commands to pass, and no remaining delta.
- `NOT_PROVEN` means evidence or review disproves the issue promise.
- `INCONCLUSIVE` means proof is blocked or external evidence is unavailable. It does not count as complete or safe for autopilot progression.

### Autopilot State Artifacts

Autopilot state is local by default and should not be committed unless it explains a review decision or the repo intentionally audits loop state in git. See `docs/autopilot/` for the operating model.

- `.pipeline/runs/<issue-id>/autopilot/autopilot-state.json` records selected issue, logical lock owner, mode, allowed capabilities, and last safe checkpoint.
- `.pipeline/runs/<issue-id>/autopilot/loop-telemetry.json` records command status, iteration usage, attempted side effects, and stop reason.
- `.pipeline/runs/<issue-id>/autopilot/run-log.jsonl` is append-only completed-attempt history.
- `.pipeline/runs/<issue-id>/autopilot/run.lock` is the short-lived exclusive local writer token and must never be treated as completion evidence.

`autopilot.token_budget` remains a configured limit for a future assisted or
unattended runtime. Do not claim token enforcement from a nonexistent
`<run-state>/token-budget.json` artifact.

Any autopilot artifact that reports `NOT_PROVEN`, `INCONCLUSIVE`, exhausted budget, failed review, ambiguous auth, or active kill switch must stop progression instead of opening or advancing work as successful.

### `<run-state>/ship-manifest.json`

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
  "artifacts": ["plans/active/issue-###.plan.json", "<run-state>/review-results.json"]
}
```
