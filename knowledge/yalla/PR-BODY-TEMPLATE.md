# PR and Commit Templates

Reference for `/yalla` shipping. Optimize the PR for human attention: intent, risk, reviewer entry points, validation evidence, documentation impact, and merge policy.

`$BASE_BRANCH` is the configured base branch (`.claude/YALLA.md` `base_branch`, default `main`). `$REPO` is the resolved `<owner>/<repo>`. The unit of work is identified as `issue-###`.

## Commit Message Format

```bash
git add [specific files - not git add .]
git commit -m "feat(scope): [description]

[What changed and why]

Refs: issue-###
Generated with Claude Code via /yalla

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## PR Creation

```bash
git push -u origin session/issue-###-[slug]
gh pr create --base "$BASE_BRANCH" --title "[issue-###] [description]" --body "$(cat <<'EOF'
## Summary
- [What changed]
- [Why this is the smallest correct change]

## Risk Tier
- [low|medium|high] - [why]

## Product Intent
- Applies: [true|false and why]
- Outcome/metric: [desired outcome + metric/proxy]
- MVP scope: [smallest shipped slice]
- Intended-vs-implemented: [Pass/N/A/accepted risk]

## Reviewer Entry Points
- [files/flows worth human attention]
- [generated/mechanical files that do not need line-by-line review, if any]

## Validation Evidence
- [commands, screenshots, traces, transcripts, or accepted gaps]
- [CI status from gh pr checks when available]

## Evidence Gates
- External grounding: [sources + implementation consequence, or N/A with reason]
- Proof boundaries: [criterion -> seam + false-success condition, or N/A with reason]
- Runtime E2E: [environment/base/guardrails/proves/does-not-prove, or N/A with reason]
- Generative gates: [surface parity / trust map / volume envelope / lifecycle states / UI proof — Pass or N/A with reason]

## Documentation Impact
- [docs updated, or credible no-impact reason]

## Non-Engineer Summary

What changed:
Why it matters:
Who is affected:
What could go wrong:
How we tested it:
Decision needed from the operator/maintainer:

## Outcome
- [PROVEN | NOT_PROVEN | INCONCLUSIVE] - [one-line basis]

## Review Checks
- [x] security-check: Pass
- [x] correctness/success-invariant-check: Pass
- [x] test/evidence-check: Pass
- [x] reviewability-check: Pass
- [x] intended-vs-implemented-check: Pass [or N/A with reason]
- [x] operator-understanding-check: Pass [or N/A for light-mode trivial changes]
- [x] external-grounding-check: Pass [or N/A with reason]
- [x] runtime-e2e-proof-check: Pass [or N/A with reason]
- [x] surface-parity/trust-map/volume-envelope/lifecycle-state/ui-proof: [Pass or N/A with reason]
- [x] risk-triggered checks: [list triggered checks + Pass, or N/A with reason]

## Artifacts
- [Committed artifacts that matter for review, or N/A - evidence summarized above]
- Visual explainer: [path or N/A — include only when it clarifies a cross-boundary decision; it is not proof evidence]

## Merge Policy
- `pr-only` by default. Auto-merge only if explicitly approved in this run.

Refs #NNN
EOF
)"
```

Use `Closes`/`Fixes`/`Resolves #NNN` only when the PR targets the repo's **default** branch — GitHub auto-closes the issue on merge. If the PR targets a non-default `$BASE_BRANCH` (e.g. a staging/integration branch), use `Refs #NNN` instead and reconcile the issue manually after merge: close completed issues, or comment on child/blocked issues that remain open.

## CI Evidence

After PR creation, use:

```bash
gh pr checks --json name,bucket,state,workflow,link
```

Put check status in the PR body or a PR comment. Do not create a follow-up commit solely to update `.pipeline/ship-manifest.json` with the PR number or final check state.

## Final Output Format

```text
YALLA COMPLETE - issue-###

Issue:     [title]
Branch:    session/issue-###-[slug]
PR:        #ZZZ
Risk:      [low|medium|high]
Outcome:   [PROVEN|NOT_PROVEN|INCONCLUSIVE]
Checks:    [summary]
Docs:      [updated/no-impact]
Merge:     PR created; not merged unless explicitly approved
```
