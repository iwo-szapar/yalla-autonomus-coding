# Yalla Autopilot Runbook

This runbook describes how to operate Yalla as a scheduled, PR-only loop. The current shipped command is a single-issue `dry-run`; anything beyond that should graduate through the readiness checklist before it mutates GitHub or opens PRs unattended.

## Current Baseline

Run one issue locally without mutating GitHub:

```bash
npm run yalla:autopilot -- run --issue issue-### --mode dry-run
npm run yalla:autopilot -- queue --mode dry-run
```

The dry-run path must remain safe:

- Resolve the target repo from `YALLA_REPO`, then `gh repo view`, then a placeholder.
- Probe one canonical `issue-###`.
- Write `.pipeline/autopilot-state.json` and `.pipeline/loop-telemetry.json`.
- Make no GitHub mutations.
- Never claim completion unless the run's proof-contract verdict is `PROVEN`.

The queue dry-run writes `.pipeline/autopilot-queue-report.json`. In GitHub mode it uses `yalla-ready` as the default eligibility label and skips `blocked`, `needs-human`, and `do-not-autopilot` by default. In Linear mode it uses the configured `ready_states` plus any equivalent labels and writes the same local report before mutating Linear.

## Operating Levels

Use levels to make automation reversible and observable before increasing autonomy.

| Level | Mode | What it may do | Human gate |
|-------|------|----------------|------------|
| L0 | Local dry-run | Inspect one issue and write local telemetry | None |
| L1 | Scheduled report-only | Rank eligible issues and post or upload a report | None, no code changes |
| L2 | Assisted PR | Prepare a branch and PR for one eligible issue | Human approves plan or environment |
| L2.5 | Unattended PR | Open a PR for low-risk eligible issues | Human reviews PR before merge |
| L3 | Full unattended loop | Select, build, prove, and open PRs on schedule | Explicit opt-in and kill switch |

Default posture is PR-only. Do not auto-merge unless the target repo explicitly opts in and the current run explicitly asks for it.

## Eligibility

Queue selection should be boring and auditable. A scheduled loop should only consider issues that satisfy all required filters:

- Issue has an explicit automation label, for example `yalla-ready`.
- For Linear, issue state is in `task_system.ready_states` and team/project scope matches the repo config.
- Issue is open and not already linked to an active branch, PR, or lock file.
- Issue has enough context to produce acceptance criteria without guessing.
- Issue is not labeled `blocked`, `needs-human`, `do-not-autopilot`, or equivalent.
- Risk tier is within the configured level's allowed set.
- Repo checks, secrets, and permissions pass preflight.

Ranking can then sort by deadline, priority label, age, and estimated scope. Ranking must never override a failed eligibility filter.

## Human Modes

Configure how much human participation is required per repo or per run:

- `fyi` - report actions and outcomes, no approval stop.
- `approval` - stop before code changes, PR creation, or both.
- `strict` - require approval at every irreversible step and for any ambiguous proof.

High-risk tasks should force `strict` even when the repo default is lower ceremony.

## State Files

Scheduled runs need durable state so retries do not double-spend tokens or duplicate work.

- `.pipeline/autopilot-state.json` - current loop state, lock owner, selected issue, last safe checkpoint.
- `.pipeline/loop-telemetry.json` - timing, command results, proof verdicts, and stop reasons.
- `.pipeline/run-log.jsonl` - append-only per-attempt events for audit and debugging.
- `.pipeline/token-budget.json` - soft and hard limits for model/tool usage per loop.

State files are local by default. Commit them only when they explain a review decision or when the repo intentionally uses committed state for audit.

## Stop Rules

The loop must stop instead of pushing through uncertainty when any of these happen:

- Proof-contract verdict is `NOT_PROVEN` or `INCONCLUSIVE`.
- A required command fails twice for the same reason.
- A reviewer check returns Fail.
- The diff exceeds configured size, file-count, or risk limits.
- Token, time, or retry budget is exhausted.
- GitHub auth, branch protection, or permission checks are ambiguous.
- The issue context is insufficient or contradicts repo knowledge.
- A kill switch is active.

Stop states should preserve artifacts and leave a clear next action for a human.

## GitHub Actions Pattern

If you wire this into GitHub Actions, keep the workflow conservative:

- Trigger manually first with `workflow_dispatch` before adding a schedule.
- Use least-privilege `permissions`.
- Use a GitHub Environment approval gate before moving past report-only.
- Run one issue per job.
- Upload `.pipeline/*` artifacts on every exit path.
- Use concurrency groups so one repo cannot run two autopilot jobs at once.
- Keep the default mode `dry-run` until the readiness checklist passes.

A copyable workflow template lives at `docs/autopilot/templates/yalla-autopilot.yml`. It is `workflow_dispatch` only, runs queue dry-run, and uploads `.pipeline/*`; copy it into a target repo only after onboarding checks pass.

## OpenCode Runtime Pattern

When using an OpenCode GitHub Action or other coding runtime, preserve the maker/checker split:

- Maker executes the planned implementation.
- Checker verifies the proof contract, runs tests, and performs binary review.
- The same agent must not be the only judge of its own work.
- Runtime prompts should reference `YALLA.md`, `knowledge/yalla/`, and this runbook instead of hardcoding project-specific rules.

## Kill Switch

Every scheduled loop needs an immediate disable path. Accept at least one of:

- Repository variable such as `YALLA_AUTOPILOT_ENABLED=false`.
- Blocking label such as `do-not-autopilot`.
- Workflow input `mode=dry-run` overriding configured mutation modes.
- Removing required automation labels from all issues.

The kill switch must be checked before selecting work and again before mutating GitHub.

## Promotion Checklist

Before increasing operating level, complete `docs/autopilot/readiness-checklist.md` and keep evidence from the last passing run.
