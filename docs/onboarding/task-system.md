# Task System Setup

Yalla works best when a task tracker is the canonical work store. GitHub Issues are the default, Linear is supported as a portable tracker shape, and file-only mode is available for local experiments. Tracker-backed tasks are easier to resume, review, and automate because the plan, PR link, and proof verdict have a durable home.

## Tracker Contract

Every tracker mode should support the same lifecycle:

- Intake: read title, description, comments, labels/states, assignee, priority, and links.
- Plan writeback: comment the plan-verification brief before implementation.
- Start: move the task to an in-progress state when a branch is cut.
- Review: attach the PR and move to review when the proof artifacts are ready.
- Block: move to a needs-human/blocked state when the proof contract is `INCONCLUSIVE` or context is insufficient.
- Close: comment the final `PROVEN` / `NOT_PROVEN` / `INCONCLUSIVE` verdict and only move to done when the configured policy allows it.

The tracker is not the proof source. `.pipeline/*` and PR checks remain the proof source; the tracker receives a concise summary and links.

## Linear Mode

Use Linear when your team's backlog and sprint board already live there:

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

Recommended Linear labels mirror the GitHub defaults:

- `yalla-ready` - issue is eligible for report-only queue selection.
- `blocked` - issue cannot be selected.
- `needs-human` - issue needs clarification or a decision.
- `do-not-autopilot` - issue must never be selected by automation.
- `risk:low`, `risk:medium`, `risk:high` - optional risk caps for autopilot.

For a first Linear rollout, keep automation at report-only or assisted-PR mode. A good first milestone is: Yalla reads one `CAP-123`, posts the plan, opens a PR, and comments the proof verdict, but a human still merges.

## Required Labels

Create these labels before using GitHub queue dry-run or scheduled autopilot:

- `yalla-ready` - issue is eligible for report-only queue selection.
- `blocked` - issue cannot be selected.
- `needs-human` - issue needs clarification or a decision.
- `do-not-autopilot` - issue must never be selected by automation.

Recommended priority labels:

- `p0` - urgent or highest priority.
- `p1` - important.
- `p2` - normal planned work.

Optional risk labels:

- `risk:low`
- `risk:medium`
- `risk:high`

Optional type labels:

- `type:bug`
- `type:feature`
- `type:docs`
- `type:refactor`
- `type:hotfix`

## Create Labels With `gh`

Run from the target repo:

```bash
gh label create yalla-ready --color 0E8A16 --description "Ready for Yalla automation"
gh label create blocked --color B60205 --description "Blocked from execution"
gh label create needs-human --color D93F0B --description "Needs human clarification"
gh label create do-not-autopilot --color 5319E7 --description "Never select for autopilot"
gh label create p0 --color B60205 --description "Highest priority"
gh label create p1 --color D93F0B --description "High priority"
gh label create p2 --color FBCA04 --description "Normal priority"
```

If your repo already has labels, map them in `.claude/YALLA.md` instead of duplicating names.

## Issue Template

Use enough structure that Yalla can write acceptance criteria without inventing context. This shape works for GitHub issue templates and Linear issue descriptions:

```markdown
## Intent
What should be true for the user/operator after this ships?

## Acceptance Criteria
- [ ] Concrete observable behavior
- [ ] Negative or false-success path, if relevant
- [ ] Docs/config updates, if relevant

## Context
Relevant files, screenshots, logs, PRs, incidents, or decisions.

## Constraints
Known non-negotiables, risky areas, or things not to change.

## Verification
Commands or manual checks a human would run.
```

For browser-facing bugs, include the exact manual repro steps. Yalla should convert them into a browser proof plan:

```markdown
## Browser Repro
1. Go to /workspace.
2. Type continuously while autosave shows "Saving..." and then "Saved".
3. Navigate away and back.
4. Reload and confirm text persists.

## Expected
Typed characters never disappear, the caret stays where the user is typing, no console/network errors appear, and the saved text survives navigation/reload.
```

A copyable template lives at `docs/onboarding/templates/yalla-task.md`. Copy it into your target repo as `.github/ISSUE_TEMPLATE/yalla-task.md` if you want GitHub's issue-template UI to enforce the shape.

## Queue Dry-Run

After labels exist:

```bash
npm run yalla:autopilot -- queue --mode dry-run
```

The command:

- lists open issues labeled `yalla-ready`,
- skips issues with block labels,
- scores priority labels,
- writes `.pipeline/autopilot-queue-report.json`,
- does not mutate GitHub.

For Linear, queue dry-run should use the same eligibility rules against configured states/labels and write a local `.pipeline/autopilot-queue-report.json` before any Linear mutation is enabled.

## Eligibility Rules

An issue is eligible only when:

- it is open,
- it has the configured eligibility label,
- it has no configured block label,
- it has enough context for acceptance criteria,
- it is not already linked to an active branch or PR,
- its risk is allowed by the current autopilot level.

Queue ranking must never override eligibility. A `p0` issue with `blocked` stays blocked.

## File-Only Mode

Use `tracking_mode: file-only` when:

- the repo is not on GitHub,
- `gh` is unavailable,
- you are experimenting locally,
- the task should not create issues or PRs.

State lives in `.pipeline-state.json` and `plans/`. File-only mode is fine for manual runs; it is not recommended for scheduled autopilot because queue selection and team visibility are weaker.
