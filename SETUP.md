# Setup

Get Yalla running in your repo in about five minutes.

## Prerequisites

- **[Claude Code](https://claude.com/claude-code)** — Yalla is a set of skills and agents that run inside it.
- **[GitHub CLI](https://cli.github.com)** — run `gh auth login` once. Yalla uses it to open PRs and, in `tracking_mode: github`, to create/read issues. If you skip this while `tracking_mode: github`, Yalla halts; use `tracking_mode: linear` for Linear-backed work or `file-only` only when you deliberately do not want external tracking.
- **git** — you're shipping branches and PRs, so a normal git repo with a remote.
- **Node 20+** — only if you want to run the eval harness (`eval/yalla/`). The pipeline itself doesn't need it; your project's own toolchain does.

Check you're ready:

```bash
gh auth status      # should say "Logged in to github.com"
git remote -v       # should show your origin
```

## Install

Two paths. Both end with the same `.claude/` layout.

### Option A — as a plugin (recommended)

```
/plugin marketplace add iwo-szapar/yalla
/plugin install yalla
```

The plugin ships the full engine — skills, agents, and the knowledge base (the skills load it from the plugin via `${CLAUDE_PLUGIN_ROOT}`). The only thing you add to your own repo is a project config file:

```bash
# from your project root
mkdir -p .claude
curl -sL https://raw.githubusercontent.com/iwo-szapar/yalla/main/YALLA.example.md -o .claude/YALLA.md
# then edit .claude/YALLA.md
```

The eval harness and autopilot are not part of the plugin — clone the repo (Option B) if you want to run `npm run eval:yalla:*` or the autopilot.

### Option B — clone + vendor with install.sh

`install.sh` copies the engine into your repo's `.claude/` and rewrites the `${CLAUDE_PLUGIN_ROOT}` references to `.claude/` paths so they resolve without the plugin.

```bash
git clone https://github.com/iwo-szapar/yalla
cd your-project
/path/to/yalla/install.sh .
```

## What lands in your repo

The installer copies the engine into `.claude/` and seeds a config you'll edit. It copies **only** `skills/`, `agents/`, `knowledge/yalla/`, and the `YALLA.md` template — the eval harness stays at the Yalla repo root and is not part of your project's `.claude/`.

```
your-project/.claude/
├── skills/            yalla, yalla-plan, yalla-review, yalla-team, yalla-audit
├── agents/            yalla-lead, yalla-implementer, yalla-tester, yalla-reviewer
├── knowledge/yalla/   pipeline mechanics + the project check definitions you customize
└── YALLA.md           ← your config (the one file you edit)
```

The installer never overwrites an existing `.claude/YALLA.md`, so re-running it to pick up engine updates is safe.

For a new repository, use [`docs/onboarding/README.md`](docs/onboarding/README.md) after install. It is the end-to-end checklist for config, labels, task templates, project checks, evals, and autopilot readiness.

Executable onboarding checks live in the cloned Yalla repo:

```bash
npm run yalla:onboard -- check --config /path/to/your-project/.claude/YALLA.md
npm run yalla:onboard -- init --config /path/to/your-project/.claude/YALLA.md
npm run yalla:onboard -- labels --dry-run --config /path/to/your-project/.claude/YALLA.md
npm run yalla:onboard -- template --dry-run --config /path/to/your-project/.claude/YALLA.md
npm run yalla:run -- doctor --config /path/to/your-project/.claude/YALLA.md
npm run yalla:run -- goal --config /path/to/your-project/.claude/YALLA.md --message "Ship a verified small change" --criterion "tests pass" --evidence "npm test"
```

## First-run config

Open `.claude/YALLA.md` and set these things. Everything else has sane defaults.

1. **base_branch** — what PRs target. `main`, `develop`, `staging`, whatever you cut work from.
2. **commands** — your real `test` / `typecheck` / `build` / `lint` commands. Set any to `""` to skip that gate (a Python project might have no `typecheck`).
3. **models** — optional phase-level model hints (`classify`, `plan`, `implement`, `test`, `review`, `summarize`) so cost/quality routing is visible in doctor/status/report output.
4. **verifiers** — optional proof commands or artifact locations (`api`, `ui`, `perf`, `docs`, `visual`, etc.) so success evidence is explicit before long-running loops.
5. **test_dir** — where tests live, so the tester puts new tests in the right place.
6. **task_system** — GitHub labels or Linear states that define ready/in-progress/review/blocked/done.
7. **gotchas** — the non-obvious rules a new contributor trips on. This is your project's scar tissue. Start with two or three real ones; you'll add more as the pipeline catches mistakes.
8. **risk_gates** — which subsystem checks to arm (payments, migrations, async, auth, browser interactions, …). Only the ones that match your stack.

That's the whole adaptation. No code changes. The deeper "how do I fit this to my project" guidance lives in [CUSTOMIZING.md](CUSTOMIZING.md).

If you use GitHub tracking, also create the labels and issue template from [`docs/onboarding/task-system.md`](docs/onboarding/task-system.md) before trying queue dry-run or scheduled automation. If you use Linear tracking, configure the Linear state mapping in `task_system` and keep automation in dry-run/report-only mode until Yalla can read the issue, write the plan comment, attach the PR, and post the final proof verdict without manual setup.

## Your first task

```
/yalla add a healthcheck endpoint
```

Here's what happens:

1. **Classify** — Yalla reads the task and picks the right ceremony: a `task_type` (this one's a `feature`), a risk tier, an evidence mode, and which gates to arm. A one-line fix wouldn't get the full treatment; a new endpoint does.
2. **Track** — it opens a GitHub issue and cuts a worktree branch.
3. **Plan** — it researches your codebase and proposes an approach with acceptance criteria written *before* any code. **It stops and asks you to approve.** Read the plan, approve or redirect.
4. **Work** — it builds in vertical slices: for each acceptance criterion it writes a failing behavior test at the highest correct seam, then the smallest code that passes it.
5. **Test** — it runs your suite until green and records falsifiable evidence (`VERIFIED` / `NOT VERIFIED` / `INCONCLUSIVE`) for each claim.
6. **Review** — independent reviewers each answer one binary question (security? complexity? correctness?). Any Fail blocks the ship and gets fixed. The author never reviews their own code.
7. **Compound** — it captures any durable learning to its smallest lasting home.
8. **Ship** — it writes `.pipeline/outcome-evaluation.json` with a `PROVEN` / `NOT_PROVEN` / `INCONCLUSIVE` verdict, commits the specific files, and **opens a PR — PR-only by default.** It won't merge unless you explicitly asked in this run.

You approve once (the plan) and review one PR at the end. The middle runs itself. A run is only described as done when the verdict is `PROVEN`, and `PROVEN` is backed by the evidence artifacts, not by the agent's say-so.

For first-time setup, run `/onboard` before `/yalla`. It checks your config, labels, issue template, command setup, and writes `.pipeline/yalla-onboarding-dashboard.html` so you can see what is done and what is still missing.

For local run observability from the cloned Yalla repo:

```bash
npm run yalla:run -- event --config /path/to/your-project/.claude/YALLA.md --event stage.started --phase plan --message "Planning started"
npm run yalla:run -- checkpoint --config /path/to/your-project/.claude/YALLA.md --phase test --message "Focused tests passed"
npm run yalla:run -- evaluate --config /path/to/your-project/.claude/YALLA.md --evaluator reviewer --verdict PASS --message "Evidence is sufficient"
npm run yalla:run -- loop --config /path/to/your-project/.claude/YALLA.md
npm run yalla:run -- status --config /path/to/your-project/.claude/YALLA.md
npm run yalla:run -- report --config /path/to/your-project/.claude/YALLA.md
npm run yalla:run -- mine-sessions --config /path/to/your-project/.claude/YALLA.md
npm run yalla:run -- export --config /path/to/your-project/.claude/YALLA.md
```

These helpers write `.pipeline/goal-contract.json`, `.pipeline/events.jsonl`, `.pipeline/checkpoints/*`, `.pipeline/latest-checkpoint.json`, `.pipeline/evaluator-results.json`, `.pipeline/loop-state.json`, `.pipeline/session-mining-report.json`, `.pipeline/report.html`, and optional `.pipeline/export-*` bundles. `resume` and `rewind` return instructions only; they do not run destructive Git commands.

To resume an interrupted run:

```
/yalla issue-123
npm run yalla:run -- resume --config /path/to/your-project/.claude/YALLA.md
```

## Optional: run the eval harness

The eval harness grades the pipeline against itself — proof-contract, test-inventory, and outcome-quality suites. It lives at the Yalla repo root and needs its own install (deps: `tsx`, `vitest`, `zod`):

```bash
cd /path/to/yalla       # the Yalla repo, not your project
npm install
npm run eval:yalla:smoke   # all eval suites; fails if any suite fails
npm test                   # the unit tests behind the runners
```

Single-issue autopilot dry-run — probes one issue, writes `.pipeline/autopilot-state.json` and telemetry, mutates nothing on GitHub:

```bash
npm run yalla:autopilot -- run --issue issue-### --mode dry-run
npm run yalla:autopilot -- queue --mode dry-run
```

The queue command writes `.pipeline/autopilot-queue-report.json`, selects from issues labeled `yalla-ready`, and skips block labels such as `blocked`, `needs-human`, and `do-not-autopilot`. If you want scheduled or unattended operation, follow [`docs/autopilot/README.md`](docs/autopilot/README.md) and complete [`docs/autopilot/readiness-checklist.md`](docs/autopilot/readiness-checklist.md) before allowing any mode beyond dry-run/report-only.

You don't need any of this to use Yalla day to day. It's there to keep the proof contract honest as the pipeline evolves.

## Tracking modes

Set `tracking_mode` in `YALLA.md`.

- **`github`** (default) — GitHub Issues are the canonical task store. Each run is an `issue-###`. Recommended; survives across machines and is visible to your whole team.
- **`linear`** — Linear issues are the canonical task store. Each run is a tracker issue such as `CAP-123`; GitHub still receives the code branch and PR. Use this when product/engineering work already lives in Linear and the bottleneck is plan/setup/test handoff.
- **`file-only`** — no external store. State lives in `.pipeline-state.json` and `plans/`. Use this deliberately for private experiments or repos without a GitHub remote.
- **`db`** — advanced. A SQL task table backs the run. See `knowledge/yalla/SQL-TEMPLATES.md`. Only reach for this if you already run a project tracker in Postgres and want Yalla to write to it.

## Troubleshooting

**`gh` not authenticated** — GitHub tracking halts because the issue is the canonical work record. Run `gh auth login` and re-run. If you intentionally want local-only tracking, set `tracking_mode: file-only` in `YALLA.md`.

**Linear issue not picked up** — confirm `tracking_mode: linear`, `task_system.provider: linear`, and that `ready_states`, `in_progress_state`, and `review_state` match the exact Linear workflow names. Queue selection should never guess from screenshots or free text when the state mapping is missing.

**"No test command" / tests don't run** — your `commands.test` in `YALLA.md` is empty or wrong. Set it to the exact command you run by hand (e.g. `npm test`, `pytest`, `go test ./...`). If your project genuinely has no tests, leave it `""` — the test gate is skipped, but you lose the safety net and most runs will land `INCONCLUSIVE` instead of `PROVEN`.

**PR targets the wrong branch** — `base_branch` is wrong. Set it to the branch you actually merge into. If your team ships through `staging` or `develop`, say so here; the default is `main`.

**Plan never appears / it just starts coding** — the task likely classified as `tiny-hotfix`, which skips full plan ceremony by design. For the full adversarial plan on any task, use `/yalla-plan <task>`.

**Run says `NOT_PROVEN` or `INCONCLUSIVE`** — that's the proof contract doing its job, not a bug. Read `.pipeline/outcome-evaluation.json`: it names the remaining delta or the human decision still needed. `INCONCLUSIVE` still opens a PR, clearly labeled.

**Engine update didn't take** — re-run `install.sh`; it refreshes `skills/`, `agents/`, and `knowledge/yalla/` but preserves your `YALLA.md`.
