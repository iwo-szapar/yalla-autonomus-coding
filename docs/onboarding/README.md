# Project Onboarding

Use this guide when installing Yalla into a new repository. The goal is not to fill every optional field. The goal is to give the pipeline enough local truth to plan, test, review, and open PRs without guessing.

## What You Need Before First Run

Required:

- A git repository with a normal default branch.
- Claude Code with the Yalla plugin installed, or a vendored `.claude/` from `install.sh`.
- GitHub CLI authenticated if you want issue/PR tracking: `gh auth status`.
- `.claude/YALLA.md` copied from `YALLA.example.md` and edited for your repo.
- Working project commands for install, test, typecheck, build, and lint, or explicit `""` values for gates you do not have.
- Optional model routing hints for classify, plan, implement, test, review, and summarize.
- Optional verifier registry entries for deterministic commands, visual evidence, benchmarks, and fuzzy evaluator checks.
- Test layout fields so the tester knows where tests belong.
- At least three project gotchas that a new contributor would otherwise miss.
- A small set of risk gates that match subsystems your repo actually has.

Recommended before autopilot:

- GitHub labels from `docs/onboarding/task-system.md`.
- A few well-shaped issues with context and acceptance criteria.
- A baseline `knowledge/yalla/PROJECT-CHECKS.md` customized to your repo.
- At least one project-specific eval fixture or documented proof gap from `docs/onboarding/evals.md`.
- Completed L0 items from `docs/autopilot/readiness-checklist.md`.

## Onboarding Sequence

1. Install Yalla.
2. Create `.claude/YALLA.md`.
3. Run the config checklist below.
4. Customize `knowledge/yalla/PROJECT-CHECKS.md` only where your repo has real invariants.
5. Configure GitHub labels and issue shape.
6. Run one manual `/yalla` task with a small bug or docs improvement.
7. Run `npm run eval:yalla:smoke` from the Yalla repo if you plan to modify evals or autopilot.
8. Run `npm run yalla:autopilot -- queue --mode dry-run` only after labels exist.
9. Move to scheduled/report-only automation only after the autopilot readiness checklist passes.

Executable checks:

```bash
npm run yalla:onboard -- dashboard --config /path/to/your-project/.claude/YALLA.md
npm run yalla:onboard -- init --config /path/to/your-project/.claude/YALLA.md
npm run yalla:onboard -- check --config /path/to/your-project/.claude/YALLA.md
npm run yalla:onboard -- labels --dry-run --config /path/to/your-project/.claude/YALLA.md
npm run yalla:onboard -- template --dry-run --config /path/to/your-project/.claude/YALLA.md
npm run yalla:run -- doctor --config /path/to/your-project/.claude/YALLA.md
```

Only `--apply` mutates labels or writes the issue template. Dry-run commands only report what would happen.

Inside Claude Code, use `/onboard` for the guided version. It runs the checks and opens or points you to `.pipeline/yalla-onboarding-dashboard.html`.

## Config Checklist

Open `.claude/YALLA.md` and fill these sections in this order:

- `repo` - leave blank for `gh repo view` autodetection, or set `owner/repo` if automation runs outside the repo checkout.
- `project_name` - short human-readable name.
- `base_branch` - the branch PRs target.
- `tech_stack` - one sentence a senior engineer would use to orient a new contributor.
- `commands.install` - exact dependency install command, or `""` if none.
- `commands.test` - exact test command. Do not guess. If this is wrong, most runs become `INCONCLUSIVE`.
- `commands.typecheck`, `commands.build`, `commands.lint` - exact commands or `""`.
- `models` - optional phase-level routing hints. Valid keys are `classify`, `plan`, `implement`, `test`, `review`, and `summarize`.
- `verifiers` - optional proof commands or artifact paths. Common keys are `api`, `ui`, `browser_interactions`, `perf`, `docs`, `visual`, and `benchmark`.
- `test_dir`, `test_file_glob`, `test_setup_file` - match existing conventions.
- `tracking_mode` - use `github`, `linear`, `file-only`, or `db`. Use `linear` when Linear is already the canonical sprint board.
- `task_system` - map GitHub labels or Linear workflow states for ready/in-progress/review/blocked/done.
- `domains` - map your team's words to subsystems. Use words that appear in issue titles.
- `gotchas` - specific rules that prevent known mistakes.
- `risk_gates` - only gates that match real subsystems.
- `autopilot` - keep `enabled: false` until dry-run and readiness checks pass.

## Minimum Useful `YALLA.md`

```yaml
repo: ""
project_name: my-project
base_branch: main
tech_stack: "Node + TypeScript API with Postgres and React frontend"

commands:
  install: "npm install"
  test: "npm test"
  typecheck: "npm run typecheck"
  build: "npm run build"
  lint: "npm run lint"

models:
  classify: "cheap"
  plan: "sonnet"
  implement: "sonnet"
  test: "sonnet"
  review: "opus"
  summarize: "cheap"

verifiers:
  api: "npm test"
  ui: "npm run test:e2e"
  browser_interactions: "npm run test:e2e -- --grep @browser-interaction"
  visual: ".pipeline/visual-evidence/"

test_dir: tests/
test_file_glob: "**/*.test.*"
test_setup_file: ""

tracking_mode: github
issue_id_format: "issue-###"

task_system:
  provider: github
  ready_label: yalla-ready
  block_labels: [blocked, needs-human, do-not-autopilot]
  priority_labels: [p0, p1, p2]

# Linear variant:
# tracking_mode: linear
# issue_id_format: "CAP-###"
# task_system:
#   provider: linear
#   team: CAP
#   ready_states: [Ready, Selected]
#   in_progress_state: "In Progress"
#   review_state: "In Review"
#   blocked_state: "Needs Human"
#   done_state: Done

domains:
  - keywords: [auth, login, oauth, session]
    domain: auth
  - keywords: [billing, payment, checkout]
    domain: payments
  - keywords: [api, endpoint, route]
    domain: api

gotchas:
  - "Replace this with a real import/runtime convention from your repo."
  - "Replace this with a real security or data-handling constraint."
  - "Replace this with a real testing or deployment constraint."

risk_gates:
  - name: identity-routing-check
    triggers_on: [auth]
  - name: payment-integrity-check
    triggers_on: [payments]

autopilot:
  enabled: false
  level: L0
  human_mode: strict
  eligible_labels: [yalla-ready]
  block_labels: [blocked, needs-human, do-not-autopilot]
  auto_merge: false
```

## First Task Shape

Pick a task with a visible result and low blast radius:

```text
/yalla add a healthcheck endpoint that returns 200 and {"ok":true}
```

Avoid these for the first run:

- broad refactors,
- migrations,
- auth or payment changes,
- tasks with hidden acceptance criteria,
- vague prompts like "clean up the dashboard".

## Done Criteria For Onboarding

Your repo is onboarded when:

- `/yalla <small task>` opens a PR or clearly reports why it cannot.
- `.pipeline/outcome-evaluation.json` exists for the run.
- The verdict is understood: `PROVEN`, `NOT_PROVEN`, or `INCONCLUSIVE`.
- Review checks point to your real project rules, not just generic examples.
- A second run can reuse the same config without you restating repo conventions.

For operator visibility, a healthy manual run also has `.pipeline/events.jsonl`, `.pipeline/latest-checkpoint.json`, and `.pipeline/report.html`. Generate or inspect these from the cloned Yalla repo with `npm run yalla:run -- status|report|export --config /path/to/your-project/.claude/YALLA.md`.

Autopilot is onboarded separately. Do not treat a successful manual `/yalla` run as permission for scheduled automation.
