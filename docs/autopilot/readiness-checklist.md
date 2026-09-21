# Autopilot Readiness Checklist

Use this checklist before moving a repo from local dry-run to scheduled or unattended operation. If any required item is unchecked, stay at the current level.

## L0: Local Dry-Run

- [ ] `gh auth status` succeeds or the expected file-only fallback is documented.
- [ ] `YALLA_REPO` or `gh repo view` resolves the intended target repo.
- [ ] `npm run yalla:autopilot -- run --issue issue-### --mode dry-run` completes without GitHub mutations.
- [ ] `.pipeline/autopilot-state.json` records the selected issue and safe stop state.
- [ ] `.pipeline/loop-telemetry.json` records command status, timing, and proof verdict.
- [ ] `.pipeline/candidate.json` binds the run to repository, worktree, branch, base/head SHAs, contract, config, and trust policy.
- [ ] Concurrent writers are refused by `.pipeline/run.lock`, and a stale/mismatched checkpoint cannot resume automatically.
- [ ] Default capabilities are least privilege; no protected capability is persisted in `.claude/YALLA.md`.
- [ ] T1/T2 repositories pass local `release_adapter` schema/identity validation; an external operator-controlled executor owns immutable provider-identity preflight before consequential execution.
- [ ] `npm run eval:yalla:smoke` passes.

## L1: Scheduled Report-Only

- [ ] Workflow can be triggered manually with `workflow_dispatch`.
- [ ] Schedule is disabled until manual report-only runs are stable.
- [ ] Workflow uses least-privilege GitHub permissions.
- [ ] Workflow has concurrency protection for the repo.
- [ ] Parallel agents declare non-overlapping path ownership before implementation.
- [ ] Queue selection requires an explicit automation label.
- [ ] Block labels prevent selection.
- [ ] Report output includes selected issue, skipped issues, reasons, budget usage, and stop state.
- [ ] Artifacts are uploaded on success and failure.
- [ ] Kill switch is checked before work selection.

## L2: Assisted PR

- [ ] Human mode is `approval` or `strict`.
- [ ] Plan approval is required before code changes.
- [ ] One issue maps to one branch and at most one PR.
- [ ] Existing active branches or PRs lock the issue out of selection.
- [ ] The run records acceptance criteria before implementation.
- [ ] The run records deterministic proof when a deterministic seam exists.
- [ ] PR body includes proof-contract verdict and artifact summary.
- [ ] PR body names the exact candidate ID/SHA and separates candidate, baseline, infrastructure, identity, policy, and superseded failures.
- [ ] `PROVEN` is required before the PR can be described as complete or ready.
- [ ] `NOT_PROVEN` and `INCONCLUSIVE` PRs are clearly labeled for human follow-up.

## L2.5: Unattended PR

- [ ] Only low-risk or explicitly allowed medium-risk issues are eligible.
- [ ] Diff size and file-count limits are configured.
- [ ] Token, time, and retry budgets are configured.
- [ ] Remote-job budgets cap full suites and production builds per candidate, and build/reuse/duration/cost/retry telemetry is retained.
- [ ] Required checks are known for the target repo.
- [ ] Maker/checker separation is enforced.
- [ ] Failed review checks block shipment.
- [ ] Branch protection and PR check state are read from GitHub, not guessed.
- [ ] At least three consecutive assisted PR runs finished with expected artifacts and no manual rescue.

## L3: Full Unattended Loop

- [ ] Repo owner explicitly opted in to unattended operation.
- [ ] Auto-merge is disabled by default and separately opted in if wanted.
- [ ] The local runner cannot authorize protected operations or execute repository-supplied preflights; an external operator-controlled executor independently verifies exact candidate/provider identity, policy, and approval. Local receipts are telemetry only, duplicate IDs cannot repeat a recorded side effect, and pending receipts can reach terminal state after candidate drift.
- [ ] High-risk labels force `strict` mode or make the issue ineligible.
- [ ] Kill switch has been tested in a real workflow run.
- [ ] A budget-exhaustion run stops cleanly and preserves artifacts.
- [ ] A failing test run stops cleanly and preserves artifacts.
- [ ] A failed reviewer check stops cleanly and preserves artifacts.
- [ ] A permission/auth failure stops before mutation.
- [ ] Maintainers know where to inspect run logs and how to disable the loop.

## Go/No-Go Verdict

Record the promotion decision before changing levels:

```json
{
  "repo": "OWNER/REPO",
  "from_level": "L0|L1|L2|L2.5",
  "to_level": "L1|L2|L2.5|L3",
  "verdict": "go|no-go",
  "evidence": [
    "workflow run URL or local command output",
    ".pipeline/autopilot-state.json",
    ".pipeline/loop-telemetry.json"
  ],
  "open_risks": [],
  "decided_by": "human maintainer",
  "decided_at": "YYYY-MM-DD"
}
```
