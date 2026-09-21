---
name: yalla-audit
description: >
  Post-mortem diagnostic on a completed /yalla or /yalla-team run. Checks issue-based artifacts, PR evidence, review quality, and shipping discipline. Use after a run produced mediocre results, after a production incident traced to a yalla-shipped change, or periodically to improve the pipeline. Do NOT use during an active run.
argument_hint: "[issue-### or PR number of completed run to audit]"
---

# /yalla-audit

Inspect a completed run and produce prioritized findings with concrete fixes. Prefer GitHub issue/PR evidence and machine-readable artifacts over memory or prose.

`$REPO` and `$BASE_BRANCH` come from `.claude/YALLA.md` (`repo:` / `base_branch:`), with `$REPO` auto-detected via `gh repo view --json nameWithOwner -q .nameWithOwner` when blank and `$BASE_BRANCH` defaulting to `main`.

## Input

Requires an issue ID (`issue-###`, `###`) or PR number. If not provided, ask for one.

## Gathering Artifacts

Use GitHub first:

```bash
gh issue view ### --repo "$REPO" --json number,title,body,labels,assignees,state,url,closedAt,comments
gh pr list --repo "$REPO" --state all --search "###" --json number,title,state,url,headRefName,baseRefName,body,comments
gh pr view ### --repo "$REPO" --json number,title,body,state,headRefName,baseRefName,commits,comments,reviews,files
gh pr checks ### --repo "$REPO" --json name,bucket,state,workflow,link
```

Also gather when present:

- Plan file: `plans/active/issue-###-*`
- Plan JSON: `plans/active/issue-###.plan.json`
- Pipeline artifacts: `.pipeline/candidate.json`, `.pipeline/baseline.json`, `.pipeline/classification.json`, `.pipeline/diagnosis.json`, `.pipeline/acceptance-trace.json`, `.pipeline/test-evidence.json`, `.pipeline/review-results.json`, `.pipeline/ship-manifest.json`
- Operator artifacts: `.pipeline/events.jsonl`, `.pipeline/latest-checkpoint.json`, `.pipeline/checkpoints/`, `.pipeline/report.html`
- Long-running control artifacts: `.pipeline/goal-contract.json`, `.pipeline/evaluator-results.json`, `.pipeline/loop-state.json`, `.pipeline/operation-receipts.json`, `.pipeline/remote-jobs.json`, `.pipeline/session-mining-report.json`, `.pipeline/visual-evidence/`, `.pipeline/benchmarks.json`
- Export bundle: `.pipeline/export-*` when `npm run yalla:run -- export` was used for a portable audit snapshot
- Git diff/stat from the PR or branch: `git log "$BASE_BRANCH"..session/issue-###-* --stat` if branch still exists
- Learnings: `docs/learnings/` entries referencing `issue-###`

If the project uses an optional SQL task store (`tracking_mode: db`), legacy rows may be read for old archived runs only. Do not write or re-key legacy data during audit.

## Scorecard

Score each area 0-2:

- `0`: missing or materially failed
- `1`: partially present but weak or inconsistent
- `2`: strong evidence and no material gaps

Areas:

1. Classification and routing: task type, scope mode, phase split, risk tier, evidence mode, required gates, and merge policy were explicit and followed.
2. Feedback loop quality: bugs/perf/hotfixes had a repro or measurement loop before fixing.
3. Plan grounding: plan used codebase evidence, domain language, relevant docs, and prior incidents/learnings.
4. Vertical slice quality: work was split into user-testable behavior slices, not horizontal layers.
5. Test seam quality: acceptance criteria were verified through highest correct seams, with justified seam blockers only.
6. Review actionability: Fail findings had file, code, issue, and fix; pass findings checked the right artifacts.
7. Artifact and PR evidence quality: artifacts existed where useful, were current for one exact candidate, matched the PR story, and routine artifacts were not committed just for ceremony.
8. Scope and shipping discipline: diff matched plan, docs drift was handled, base/CI blockers were handled honestly, and merge policy was respected.

## Diagnostic Checks

Record a finding only when a problem exists.

### Plan Quality

- Was the plan grounded in actual files, docs, and project terms?
- Were edge/error/abuse paths identified before implementation?
- Were red-team objections resolved, accepted, or deferred explicitly?
- Was phase splitting considered for broad work?

### Implementation Quality

- Did the diff follow the approved plan or update the plan when reality changed?
- Did the change reuse existing patterns instead of inventing a parallel system?
- Did it avoid single-use abstractions, broad refactors, and unrelated cleanup?

### Test Coverage

- Does each acceptance criterion have public-seam evidence or accepted risk?
- Did tests cover the most likely negative path, not just happy path?
- Were seam blockers handled honestly?
- Did claim verification treat `INCONCLUSIVE` as risk?

### Review Effectiveness

- Did reviewers find real issues or mostly noise?
- Were findings actionable with file, exact code, issue, and fix?
- Did review run triggered gates without forcing unrelated historical checks?
- Did reviewer context stay separate from builder context where tooling allowed?

### Compound Quality

- Were durable learnings captured only when reusable?
- Were learnings routed to the smallest correct home: your conventions doc (CLAUDE.md / AGENTS.md), `.claude/YALLA.md`, or `docs/learnings/*`?

### Pipeline Hygiene

- Was candidate identity exact at every accepted checkpoint/review, and were stale or superseded artifacts excluded from proof?
- Were baseline, candidate, infrastructure, identity, policy, and superseded failures routed differently rather than fed into one repair loop?
- Did concurrent work declare non-overlapping path ownership and use a single-writer state lock?
- Did non-protected local mutations reserve unique operation IDs before execution and record terminal states? Did every protected action remain outside the local runner and go through an external operator-controlled executor that independently verified candidate, action, target, policy, and human approval?
- For T1/T2 releases, did the adapter pin immutable project identity and record remote build/reuse/cost/retry budgets per candidate?
- Was state resumable through `.pipeline-state.json`, issue comments, and PR evidence?
- Was state resumable through `.pipeline/events.jsonl`, `.pipeline/latest-checkpoint.json`, issue comments, and PR evidence?
- Were routine `.pipeline/*` artifacts kept local unless review-relevant?
- Were branch/worktree/PR links clear?

### Artifact And PR Integrity

- Do plan, artifacts, PR body, and issue comments agree?
- Does the PR body identify risk tier, reviewer entry points, validation evidence, docs impact, and merge policy?
- Was `gh pr checks` used for PR-attached CI state?

### Shipping Discipline

- Was default PR-only respected?
- If merged by agent, did state or PR evidence show explicit run-local auto-merge approval?
- Were inherited red-base or unrelated CI failures documented rather than hidden?

## Report Format

```markdown
# Yalla Audit - issue-###

## Summary
Audited [task title]. Score: [X]/16. Found [N] issues across [M] areas.

## Scorecard
| Area | Score | Evidence |
|------|-------|----------|
| Classification and routing | 0-2 | ... |
| Feedback loop quality | 0-2 | ... |
| Plan grounding | 0-2 | ... |
| Vertical slice quality | 0-2 | ... |
| Test seam quality | 0-2 | ... |
| Review actionability | 0-2 | ... |
| Artifact and PR evidence quality | 0-2 | ... |
| Scope and shipping discipline | 0-2 | ... |

## Findings

### [Area]: [Problem Title]
**Status:** Problem found
[1-2 sentence description]
**Evidence:** [specific artifact, issue comment, PR line, or command output]
**Fix:** [concrete action]
```

Order findings by impact. Omit areas where no problems were found and mark them OK in the summary.

## Anti-Patterns

- Auditing during an active run.
- Reporting generic advice disconnected from specific artifacts.
- Trusting PR prose when artifacts or checks disagree.
- Scoring tests as strong without checking the public seam.
- Treating missing routine artifacts as failure when the PR body contains adequate minimal evidence.
