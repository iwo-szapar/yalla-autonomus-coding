---
name: yalla-plan
description: >
  4-agent adversarial planning with red-team. Produces a grounded plan
  with concrete approach, files affected, acceptance criteria, and addressed risks.
  Use standalone for planning without full pipeline, or invoked by /yalla and /yalla-team.
  Do NOT use when the task is trivial (plan directly in /yalla).
argument_hint: "[description of what to build]"
---

# /yalla-plan

4-agent adversarial planning. Produces a plan grounded in the actual codebase, challenged by a red-team, sliced into tracer bullets, mapped to public test seams, and approved by the user before any code is written.

Planning must be incident-aware without becoming a universal checklist. Identify the changed workflow's success invariant, scan prior incidents/learnings for the touched subsystem, and activate only the risk gates that match the diff.

Planning must also be operator-readable for non-trivial work. Apply the operator-understanding protocol (see `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/`) and choose `light`, `default`, or `deep` understanding mode based on risk. The plan should explain the business/user behavior before code details.

`$REPO` and `$BASE_BRANCH` come from `.claude/YALLA.md` (`repo:` / `base_branch:`), with `$REPO` auto-detected via `gh repo view --json nameWithOwner -q .nameWithOwner` when blank and `$BASE_BRANCH` defaulting to `main`.

## Input

<task_input> $ARGUMENTS </task_input>

Requires a task description. If invoked from `/yalla` or `/yalla-team`, the issue number and description are already available.

---

## Step 1: Create Planning Team

Before spawning agents, read:

- `.claude/YALLA.md`
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/TASK-CLASSIFICATION.md`
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/VERTICAL-SLICES.md`
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/TEST-SEAMS.md`
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/ARCHITECTURE-DEPTH.md`
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/ARTIFACTS.md`
- `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/PROJECT-CHECKS.md`
- `${CLAUDE_PLUGIN_ROOT}/knowledge/product/PRODUCT-INTENT-FRAMEWORK.md`
- `${CLAUDE_PLUGIN_ROOT}/knowledge/product/ASSUMPTION-TESTING.md`
- `${CLAUDE_PLUGIN_ROOT}/knowledge/product/INTENDED-VS-IMPLEMENTED.md`
- Your project's conventions doc (CLAUDE.md / AGENTS.md)
- Relevant docs/decisions and docs/architecture files for the task area

If the task has unresolved domain language, ask one precise question at a time before final plan approval. If the task is a bug/perf regression and no `.pipeline/diagnosis.json` exists, run the diagnosis protocol before writing the full plan.

```
TeamCreate: team_name = "yalla-plan-issue-###"
```

| Teammate | Type | Job |
|----------|------|-----|
| codebase-analyst | general-purpose (sonnet) | Read `.claude/YALLA.md`, your conventions doc (CLAUDE.md / AGENTS.md), `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/PROJECT-CHECKS.md`, relevant docs/decisions, relevant architecture docs, affected files, and relevant `docs/incidents` / `docs/learnings` entries. Report domain terms, interfaces, seams, schemas, conventions, prior incident failure modes, and any code/doc drift. Do NOT propose solutions. |
| solution-architect | general-purpose (sonnet) | Design technical approach using deep modules and real seams. Research via WebSearch/context7. Propose interfaces, data flow, dependency strategy, vertical slices, and which architecture docs must change or stay unchanged. |
| spec-validator | general-purpose (sonnet) | Walk through as end-user. Define the success invariant, map happy, error, abuse, and edge paths, identify the most likely negative-path test, and convert behavior into testable acceptance criteria, highest correct test seams, and architecture-doc claims that need test evidence. When Product Intent applies, define the intended user/business outcome, metric/proxy, MVP boundary, and intended-vs-implemented proof needed. For features that grant access, move money, or bind identity: required to map the abuse path explicitly AND state whether a human-review gate is needed (default: yes for security-sensitive grants). |
| red-team | general-purpose (sonnet) | Challenge every assumption. Find security holes, performance issues, shallow modules, fake seams, missing repro loops, over-engineering, PRD/code/docs mismatches, and untested product assumptions. Be specific — "X will fail when Y because Z", not "this might not work". |

Read `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/TEAMMATE-PROMPTS.md` for exact spawn prompts.

## Step 2: 3-Round Discussion

**Round 1 — Parallel Research:** All 4 research independently. Codebase analyst scans repo. Architect proposes approach. Spec validator maps flows. Red team prepares objections.

**Round 2 — Challenge:** Red team challenges architect's proposal. Spec validator challenges analyst's patterns. Architect responds and iterates. All share via SendMessage.

**Round 3 — Converge:** Lead collects all findings. Red team does final pass on remaining risks. Lead synthesizes into unified plan.

## Step 3: Write Plan

Write to `plans/active/issue-###-[slug].md`, plus `plans/active/issue-###.plan.json` when useful for review/resume, with this structure:

```markdown
# issue-###: [title]

## Problem
[What's broken or missing — grounded in codebase evidence from analyst]

## Task Classification
- Type: [tiny-hotfix|bug|perf|feature|refactor|architecture|ui-prototype|logic-prototype|docs|hotfix]
- Scope mode: [EXPANSION|HOLD|REDUCTION]
- Required gates: [diagnosis, vertical_slices, test_seams, review]
- Phase split required: [true|false and why]
- Risk tier: [low|medium|high]
- Evidence mode: [minimal|standard|strict]
- Product intent gate: [applies|n/a and why]
- External grounding gate: [applies|n/a and concrete trigger]
- Runtime E2E gate: [applies|n/a and concrete trigger]
- Generative evidence gates: [surface parity, trust map, volume envelope, lifecycle states, and UI proof — each applies/N/A with a concrete reason]

## Domain Language
- [Canonical project terms from your conventions doc (CLAUDE.md / AGENTS.md), .claude/YALLA.md, docs]
- Avoided terms: [if any]

## Existing Evidence
- Codebase patterns: [files/modules]
- ADRs/decisions respected: [docs/decisions/...]
- Architecture docs read: [docs/architecture/...]
- Architecture/code alignment: [aligned | docs-drift | code-drift | intentional-change-updates-docs]
- Architecture docs to update in this PR: [paths or `none`]
- Prior incidents/learnings relevant: [docs/incidents or docs/learnings]

## Architecture Alignment
- Source-of-truth docs: [`docs/architecture/...` — why each applies]
- Code sources checked: [paths]
- PRD promise: [what behavior the PRD/plan commits to]
- Alignment verdict: `aligned` | `docs-drift` | `code-drift` | `intentional-change-updates-docs`
- Required doc updates: [paths or `none`]
- Test evidence required: [which acceptance criteria prove the architecture claims]
- Review gates: [architecture-check, architecture-docs-check, doc-alignment-check as applies]

## Interfaces and Test Seams
- [Public interface] — [invariants/error modes] — [highest correct test seam]

## Evidence Gates
- External grounding: [official/upstream source + claim, or concrete N/A reason]
- Runtime E2E preflight: [environment, base revision, guardrails, proves/does-not-prove, or concrete N/A reason]
- Surface parity: [two nearest siblings + inherited concerns, or concrete N/A reason]
- Trust map: [input writers/neutralization + output consumers/guards, or concrete N/A reason]
- Volume envelope: [busiest case, cost math, bound, or concrete N/A reason]
- Lifecycle states: [object states, behavior, negative test, or concrete N/A reason]
- UI proof: [revision-bound assertions/private artifacts, or concrete N/A reason]

## Approach
[Technical decisions from architect, refined after red-team challenges]
[Pseudo-code for key functions]

## Success Invariant
[From spec-validator — what must be true before the workflow can be marked successful]

## Plan Verification Brief
- User-visible promise: [one sentence]
- Success invariant: [this is not successful until...]
- Highest-risk assumption: [what could make this plan wrong]
- Codebase evidence checked: [paths/docs/tests inspected]
- Negative or false-success path: [what must not be accidentally marked successful]
- Proof plan: [test/browser/API/static/manual evidence for each acceptance criterion]
- Human review focus: [the 2-4 files/behaviors worth inspecting closely]
- Tracker writeback: [GitHub/Linear comment/state update that will be made before implementation]

## Product Intent
- Applies: [true/false and why]
- Intended outcome: [user/business outcome, not implementation output]
- Target user/context: [who this helps and when]
- Metric/proxy: [how we know it worked]
- MVP boundary: [smallest shipped slice that preserves the intent]
- Top kill-assumptions:
  - [assumption] — [cheapest validation/proof]
- Intended-vs-implemented proof: [tests/evidence/review checks that prove code matches intent]

## Incident Regression Map
- Related incidents/learnings: [paths, or "none found"]
- Failure modes this PR must not repeat
- Regression guard required

## Risk-Triggered Gates
- success-invariant-check: [always]
- operator-understanding-check: [applies/N/A and why]
- async-reliability-check: [applies/N/A and why]
- schema-migration-check: [applies/N/A and why]
- identity-routing-check: [applies/N/A and why]
- payment-integrity-check: [applies/N/A and why]
- intended-vs-implemented-check: [applies/N/A and why]
- email-delivery-check: [applies/N/A and why]
- generated-artifact-check: [applies/N/A and why]
- ui-journey-check: [applies/N/A and why]
- external-grounding-check: [applies/N/A and why]
- runtime-e2e-proof-check: [applies/N/A and why]
- surface-parity-check: [applies/N/A and why]
- trust-map-check: [applies/N/A and why]
- volume-envelope-check: [applies/N/A and why]
- lifecycle-state-check: [applies/N/A and why]
- ui-proof-check: [applies/N/A and why]
- browser-interaction-check: [applies/N/A and why]
- architecture-docs-check: [applies/N/A and why]
- doc-alignment-check: [applies/N/A and why]

## Vertical Slices

### Slice 1: [demoable behavior]
Type: AFK | HITL
Blocked by: None | Slice N
User-visible outcome: [what works after this slice]
Public interface: [route/endpoint/function]
Test seam: [highest correct seam]
Acceptance criteria:
- [ ] [testable behavior]
Files likely affected:
- `path` — why

## Files Affected
[From analyst — exact paths with what changes in each]

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

## Acceptance Criteria
[Testable checklist — from spec validator's user flow mapping]

## Edge Cases
[From spec validator — specific scenarios, not generic "handle errors"]

## Abuse Path (REQUIRED if feature grants access, moves money, or binds identity)
[From spec validator — how a malicious actor would attempt to bypass intended controls]
[Must answer: "Does this need a human-review gate before access is granted?"]
[If yes — describe the pending-review intermediate state]

## Risks
[From red team — unresolved objections for user to decide]
[Each risk: what could go wrong + proposed mitigation or "user decides"]

## Artifact Manifest
- `plans/active/issue-###.plan.json`
- `.pipeline/architecture-alignment.json`
- `.pipeline/product-intent.json`
- `.pipeline/external-grounding.json` [when applicable]
- `.pipeline/runtime-e2e-preflight.json` [when applicable]
- `.pipeline/acceptance-trace.json`
- `.pipeline/test-evidence.json`
- `.pipeline/review-results.json`
```

The JSON plan must follow `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/ARTIFACTS.md` and include `issue_id`, `task_type`, `phase_split_required`, `risk_tier`, `evidence_mode`, `domain_terms`, `architecture_docs`, `interfaces`, `vertical_slices`, and `risks`.

### Example: good risk section vs bad risk section

**Good:**
```markdown
## Risks
- **Wrong-account write:** The integration MCP connects to a test account, but the
  live code path reads production keys from the local env. Using the MCP to create
  records would write them to the wrong account. Mitigation: use the production key
  with a direct API call instead.
- **Rate limit on webhook endpoint:** No rate limiting on the public webhook route.
  An attacker could flood it. Mitigation: add an edge middleware rate limit, or accept
  the risk since upstream retries are bounded.
```

**Bad:**
```markdown
## Risks
- There might be some edge cases we haven't thought of
- Performance could be an issue
```

## Step 4: Shutdown Team

Send shutdown_request to all 4 teammates. Wait for confirmations. TeamDelete.

## Step 5: User Approval (MANDATORY)

Present plan summary via AskUserQuestion:
- What I'll build (2-3 sentences)
- Key technical decisions
- Red Team flags (unresolved — user decides)
- Operator understanding checkpoint: state the selected understanding depth and ask one teach-back/tradeoff question when mode is `deep`
- Questions before starting
- Options: Approve / Iterate / Show full plan / Cancel

Loop on Iterate until approved.

After approval:

1. Write or update the GitHub issue body/comment using `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/AGENT-BRIEF.md`.
2. Persist the approved plan path in `.pipeline-state.json`.
3. Initialize `.pipeline/acceptance-trace.json` with every acceptance criterion in `status: "pending"`.

## Fallback: Sub-Agent Mode

If Agent Teams fails, fall back to parallel one-shot sub-agents:
- Task repo-research-analyst — existing codebase patterns
- Task best-practices-researcher — external best practices
- Task framework-docs-researcher — framework versions, correct APIs
- Task spec-flow-analyzer — user flows, edge cases

Continue from Step 3 (Write Plan).

---

## Anti-Patterns

- Architect proposing solutions without analyst grounding them in the codebase
- Red team giving vague objections ("this might not work") instead of specific failure scenarios
- Spec validator only mapping the happy path
- Skipping Round 2 (challenge) because Round 1 looks complete
- Writing the plan before all 4 teammates have reported
- Including implementation details that belong in code, not in the plan
- Producing horizontal slices like "add DB", "build UI", "write tests" instead of behavior slices
- Listing tests without naming the public interface or highest correct seam
- Ignoring domain terms from `.claude/YALLA.md`, your conventions doc (CLAUDE.md / AGENTS.md), docs/decisions, or architecture docs
- Writing or implementing a PRD that changes a documented architecture flow without citing and reconciling the relevant `docs/architecture/*` file
- Treating architecture docs as post-PR cleanup instead of part of the PRD, test, and review contract
- Introducing a seam without a second adapter or test substitute to justify it
