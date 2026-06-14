# Yalla

**Give Claude Code a one-line task. Get back a tested, reviewed pull request.**

Yalla is an autonomous coding pipeline for [Claude Code](https://claude.com/claude-code). It turns a description into a planned, built, tested, reviewed, and shipped PR — using specialized agents and adaptive ceremony, **grounded in a project knowledge base** (your gotchas, risk checks, and architecture) and **held to a Proof Contract that a built-in eval harness grades**. A run only ships when evidence artifacts say it's proven. GitHub Issues are the task store; no database or external service required.

```
/yalla add rate limiting to the public API
```

```
        ┌──────────────────── KNOWLEDGE BASE ────────────────────┐
        │  gotchas · minimum diff · risk gates · review checks ·  │  grounds
        │  architecture · test seams · task classification         │  every phase
        └────────────────────────────┬───────────────────────────┘
                                      ▼
 minimum-diff ─▶ classify ─▶ track ─▶ plan ─▶ work ─▶ test ─▶ review ─▶ compound ─▶ ship
    │                  │       │       │        │           │          │
  pick     adversarial build  write & binary  learnings   PR — only
  ceremony + diagnosis vertical run    pass/   fed back    if verdict
  + gates  plan        slices  tests   fail    into the    is PROVEN
                                       gates   knowledge
                                      ▲
        ┌─────────────────────────────┴──────────────────────────┐
        │  PROOF CONTRACT  →  evidence artifacts (.pipeline/*)     │  grades
        │  verdict: PROVEN / NOT_PROVEN / INCONCLUSIVE             │  every run
        │  graded by the eval harness  (npm run eval:yalla:smoke)  │
        └─────────────────────────────────────────────────────────┘
```

Two things wrap the linear pipeline and make it more than a prompt: the **knowledge base** feeds project-specific constraints into every phase, and **compound** routes each run's learnings back into it — so the pipeline gets sharper the more you run it. The **Proof Contract + eval harness** sit underneath, turning "looks done" into a graded, artifact-backed verdict.

---

## What it does

| Phase | What happens |
|-------|--------------|
| **0 · Minimum Diff + Classify** | Runs the minimum-diff ladder, then picks a `task_type`, risk tier, ceremony mode, evidence mode, and gates. A no-build/docs/config answer, one-line fix, and payment-flow change get different ceremony. |
| **1 · Track** | Creates (or resumes) a GitHub issue and a worktree branch. |
| **2 · Plan** | Researches the codebase, designs an approach, and adversarially challenges it. Bugs run a diagnosis gate first. You approve before any code is written. |
| **3 · Work** | Builds in vertical slices — each one a thin, demoable end-to-end behavior — writing a failing behavior test at the highest correct seam before the implementation that passes it. |
| **4 · Test** | Runs the suite until green, verifies every acceptance criterion maps to evidence, and records falsifiable verification (`VERIFIED` / `NOT VERIFIED` / `INCONCLUSIVE`). |
| **5 · Review** | Independent reviewers each answer **one** binary question (security? complexity? correctness?). Any Fail blocks the ship. The author never reviews their own code. |
| **6 · Compound** | Captures actionable learnings to their smallest lasting home so the same mistake isn't repeated. |
| **7 · Ship** | Writes `.pipeline/outcome-evaluation.json`, commits specific files, and opens a PR — PR-only by default; never auto-merges unless you asked in this run. |

The core idea: **keep the universal pipeline small, and activate risk-specific gates only when the diff touches that subsystem.** A docs typo doesn't get dragged through payment, migration, and auth review. A change to your billing code does.

## The Proof Contract

A run is "done" only when its **verdict is `PROVEN`** — and `PROVEN` is backed by artifacts, not prose. Before shipping, Yalla writes `.pipeline/outcome-evaluation.json` with a verdict of exactly one of:

- **`PROVEN`** — every acceptance criterion is covered by valid evidence (a passing test, a static check, a browser/API probe, a smoke run), all required review checks pass, and no remaining delta exists. Only `PROVEN` may be called done, complete, or ready to merge.
- **`NOT_PROVEN`** — evidence or review shows the promise isn't satisfied. An honest outcome, not a failure to hide.
- **`INCONCLUSIVE`** — local proof is blocked or external evidence is unavailable. Can still open a PR, but the PR clearly says human review or external evidence is needed.

Missing evidence never becomes `PROVEN`. Deterministic proof is preferred — Yalla won't lean on a model judge when a concrete test or check can verify the behavior. This is what stops "looks done" from masquerading as "is done."

## Adaptive classification

Not every task deserves the same ceremony. Phase 0 first asks whether code is needed at all, then classifies the work and routes it:

- **minimum-diff gate** — no-build, config/docs, existing code, stdlib/native, installed dependency, one local edit, then new implementation only if the higher rungs fail.

- **tiny-hotfix** — one file or one value with a clear failing test: reproduce, make the smallest fix, rerun the exact test, `git diff --check`, hostile self-review inline. No heavyweight artifacts.
- **bug / perf / hotfix** — run a **diagnosis gate** before planning: reproduce the symptom, record falsifiable hypotheses, identify a regression seam.
- **feature** — full vertical-slice build with acceptance criteria written before code.
- **architecture / refactor** — a depth-and-locality exploration before proposing implementation.
- **prototype** — throwaway UI or logic prototype first, then plan production work once a direction is chosen.

Ceremony modes (`lean` / `standard` / `strict`), evidence modes (`minimal` / `standard` / `strict`), and risk tiers (`low` / `medium` / `high`) scale how much artifact weight and review depth a run carries. They never change the proof rule: only `PROVEN` is success.

## Vertical slices and test seams

Yalla builds in **tracer-bullet vertical slices** — each slice is a thin slice of real, demoable, end-to-end behavior, not a horizontal layer (no "all the models, then all the controllers"). For every acceptance criterion it writes one **failing behavior test at the highest correct seam** — the public interface a user or caller actually hits (route, endpoint, MCP tool, exported function) — *before* the implementation that makes it pass. Tests cross the public seam and mock only system boundaries; they don't reach into private internals just to satisfy a gate. If no correct seam exists, the run records `TEST_SEAM_BLOCKED` and halts for a decision instead of writing a shallow test.

## `.pipeline/*` evidence artifacts

A run leaves a trail under `.pipeline/` so a reviewer can decide where to look closely instead of re-reading everything:

- `classification.json` — task type, risk tier, evidence mode, gates armed.
- `minimum_diff_decision` inside `classification.json` — selected ladder rung, reuse targets, skipped complexity, file/LOC budget.
- `events.jsonl` — append-only run timeline: phase starts, tool/command notes, human decisions, checkpoints, and ship events.
- `checkpoints/` + `latest-checkpoint.json` — resumable save points after classify, plan, each work slice, test, review, and ship.
- `goal-contract.json` — desired end state, success criteria, constraints, budget, forbidden shortcuts, and required evidence.
- `evaluator-results.json` / `loop-state.json` — independent evaluator verdicts and long-running loop decisions.
- `visual-evidence/` / `benchmarks.json` — optional screenshot, image, and benchmark evidence rendered into the local report.
- `acceptance-trace.json` — every criterion, its proof mode, and its evidence status.
- `test-evidence.json` — commands run, pass/fail, falsifiable claim verdicts, smoke evidence.
- `review-results.json` — each binary check and its verdict.
- `intent-brief.md` / `progress.md` — what a senior reviewer needs before the diff, and the running build log.
- `outcome-evaluation.json` — the final `PROVEN` / `NOT_PROVEN` / `INCONCLUSIVE` verdict.

Artifacts are committed only when they explain non-obvious decisions, accepted risks, or review findings a reviewer needs in the diff; routine state stays local and is summarized in the PR body. Tiny hotfixes usually commit none.

## The knowledge base

The pipeline engine is generic — what makes a run *yours* is the knowledge base in [`knowledge/yalla/`](knowledge/yalla/). It's read on demand at every phase and is the difference between a generic agent and one that knows your codebase:

- **Your gotchas** — the non-obvious rules a new contributor trips on, loaded as hard constraints into every run (defined in your `YALLA.md`).
- **Review checks** ([`REVIEW-CHECKS.md`](knowledge/yalla/REVIEW-CHECKS.md)) — the binary pass/fail library, including a risk-gate set (payments, migrations, auth, async, email, generated artifacts, UI) that arms only when the diff touches that subsystem.
- **Project checks, minimum-diff, task classification, test seams, vertical slices, architecture depth, diagnosis** — the methodology files that tell the agents *how* to scope, plan, build, and verify.

It's also a **closed loop**: the **compound** phase routes each run's learnings back into the knowledge base and your `YALLA.md` gotchas, so the same mistake doesn't recur — the pipeline gets sharper the more you run it. A mature config (see [`examples/sbf/`](examples/sbf/)) carries a couple dozen earned gotchas and a full risk-gate map. An optional [**memory**](knowledge/yalla/MEMORY-PROTOCOL.md) subsystem can also persist those learnings to a project store and recall them before planning (off by default; enabled per-repo via a `memory:` block in `YALLA.md`).

## Why binary review

Most AI review produces "rate this 1–10" noise. Yalla forces every reviewer to answer one specific yes/no question with a file, a line, the offending code, and a concrete fix — or to Pass. Binary checks make disagreements resolvable and fixes obvious. The full check library is in [`knowledge/yalla/REVIEW-CHECKS.md`](knowledge/yalla/REVIEW-CHECKS.md).

## The eval harness

Yalla ships a runnable TypeScript eval harness that grades the pipeline against itself — it checks that the proof contract holds, the test inventory covers risky categories, and outcomes are scored honestly. It lives at the repo root (`eval/yalla/`), not inside `.claude/`, and needs its own install (deps: `tsx`, `vitest`, `zod`):

```bash
npm install
npm run eval:yalla:smoke    # runs proof-contract + test-inventory + outcome-quality + coverage suites
npm run eval:yalla:minimum-diff
npm run yalla:benchmark
```

The smoke suite validates that:

- legacy runs fail the strict proof contract while patched runs pass,
- `INCONCLUSIVE` never gets counted as success,
- minimum-diff fixtures reject avoidable dependencies, one-use abstractions, and over-budget diffs,
- payment / auth / async / generated-artifact / UI / migration categories are represented and map to real tests,
- model judges are rejected where a deterministic seam exists.

There's also a single-issue **autopilot dry-run** that probes one issue and writes telemetry without mutating GitHub:

```bash
npm run yalla:autopilot -- run --issue issue-### --mode dry-run
npm run yalla:autopilot -- queue --mode dry-run
```

The queue dry-run ranks eligible issues with the `yalla-ready` label, skips block labels, and writes `.pipeline/autopilot-queue-report.json` without mutating GitHub. For scheduled or unattended operation, use the staged runbook in [`docs/autopilot/`](docs/autopilot/). The default posture remains PR-only and dry-run/report-only until the readiness checklist passes.

## Install

### Option A — as a Claude Code plugin (recommended)

```
/plugin marketplace add iwo-szapar/yalla
/plugin install yalla
```

This installs the full engine — all Yalla skills, 4 agents, and the knowledge base (the skills load it from the plugin via `${CLAUDE_PLUGIN_ROOT}`). The only thing you add to your own repo is a project config:

```bash
# from your project root — create .claude/YALLA.md and edit it
mkdir -p .claude && curl -sL https://raw.githubusercontent.com/iwo-szapar/yalla/main/YALLA.example.md -o .claude/YALLA.md
```

The eval harness (`npm run eval:yalla:*`) and autopilot live in the cloned repo, not the plugin — clone it (Option B) if you want to run or extend those.

### Other agent hosts

Yalla also ships compact adapters modeled after the same single-source rule file:

- Codex: `.codex-plugin/plugin.json` plus `skills/` and `AGENTS.md`.
- OpenCode: `.opencode/plugins/yalla.mjs` injects `hooks/yalla-instructions.cjs` each turn and supports `/yalla lean|standard|strict|off` mode persistence. Copy the plugin plus `hooks/yalla-*.cjs` together.
- Gemini CLI: `gemini-extension.json` points at `AGENTS.md`.
- Cursor, Windsurf, Cline, Copilot, Kiro: copy the matching rule file from this repo.

See [`docs/agent-portability.md`](docs/agent-portability.md). Run `npm run rules:check` before releasing adapter changes.

### Option B — clone + install.sh

```bash
git clone https://github.com/iwo-szapar/yalla
cd your-project
/path/to/yalla/install.sh .
```

Either way you end up with:

```
your-project/.claude/
├── skills/            yalla, yalla-plan, yalla-review, yalla-simplify,
│                      yalla-simplify-audit, yalla-team, yalla-audit
├── agents/            yalla-lead, yalla-implementer, yalla-tester, yalla-reviewer
├── knowledge/yalla/   pipeline mechanics (classification, diagnosis, slices,
│                      seams, artifacts, review checks) + your project checks
└── YALLA.md           ← your config (the one file you edit)
```

The installer copies only the engine (`skills/`, `agents/`, `knowledge/yalla/`) and seeds `YALLA.md`. The eval harness stays at the repo root — it's not part of your `.claude/`.

For a first-time repository setup, follow [`docs/onboarding/`](docs/onboarding/) after install. It covers the project config, GitHub labels, task template, eval fixtures, and autopilot readiness path.

You can also run the executable onboarding check from the Yalla repo:

```bash
npm run yalla:onboard -- check --config /path/to/your-project/.claude/YALLA.md
npm run yalla:onboard -- init --config /path/to/your-project/.claude/YALLA.md
npm run yalla:onboard -- labels --dry-run --config /path/to/your-project/.claude/YALLA.md
npm run yalla:onboard -- template --dry-run --config /path/to/your-project/.claude/YALLA.md
```

## Configure

Open `.claude/YALLA.md` and set five things:

1. **base_branch** — what PRs target (`main`, `develop`, `staging`, …).
2. **commands** — your `test` / `typecheck` / `build` / `lint` commands.
3. **test_dir** — where tests live.
4. **gotchas** — the non-obvious rules a new contributor trips on. This is where your project's hard-won scar tissue lives.
5. **risk_gates** — which subsystem checks to arm (payments, migrations, async, auth, …).

That's the whole adaptation. No code changes. See [`CUSTOMIZING.md`](CUSTOMIZING.md).

## Use

```
/yalla <what to build>          full adaptive pipeline, single-agent build
/yalla lean <what to build>     minimum ceremony, same proof contract
/yalla strict <what to build>   strict artifacts and review posture
/onboard                        guided setup + HTML readiness dashboard
/yalla-team <what to build>     full multi-agent team (heavier, for complex work)
/yalla-plan <what to build>     just the adversarial plan
/yalla-review                   binary pass/fail review of the current diff
/yalla-simplify                 deletion-only over-engineering review of the current diff
/yalla-simplify-audit           repo-wide bloat audit
/yalla-audit <issue-### | PR#>  post-mortem on a completed run
/yalla issue-123                resume an interrupted run
```

Operator run-control helpers are also available from the cloned repo:

```bash
npm run yalla:run -- doctor
npm run yalla:run -- goal --message "Ship a verified healthcheck" --criterion "returns 200" --evidence "npm test"
npm run yalla:run -- event --event stage.started --phase plan --message "Planning started"
npm run yalla:run -- checkpoint --phase test --message "Focused tests passed"
npm run yalla:run -- evaluate --evaluator reviewer --verdict PASS --message "Evidence is sufficient"
npm run yalla:run -- loop
npm run yalla:run -- status
npm run yalla:run -- report
npm run yalla:run -- mine-sessions
npm run yalla:run -- resume
npm run yalla:run -- rewind --target plan
npm run yalla:run -- export
```

These commands are deliberately local and non-destructive. `resume` and `rewind` return the checkpoint and next action; they do not run destructive Git commands for you.

Requires the [GitHub CLI](https://cli.github.com) (`gh auth login`) for default GitHub tracking. If you intentionally want no GitHub issue/PR workflow, set `tracking_mode: file-only` in `.claude/YALLA.md`.

## Components

- **Skills** (`skills/`) — the pipeline entry points and orchestration.
- **Agents** (`agents/`) — the specialists: lead (orchestrator), implementer, tester, reviewer.
- **Knowledge** (`knowledge/yalla/`) — pipeline mechanics (classification, diagnosis, vertical slices, test seams, artifacts, agent brief, preflight) plus the customizable check definitions in `REVIEW-CHECKS.md` and `PROJECT-CHECKS.md`.
- **Eval harness** (`eval/yalla/`) — the runnable proof-contract / test-inventory / outcome-quality suites and their fixtures. Repo-root only.
- **Onboarding docs** (`docs/onboarding/`) — what each repo needs: config, labels, issue shape, project checks, and eval fixtures.
- **Autopilot docs** (`docs/autopilot/`) — staged scheduler/readiness guidance for moving from local dry-run to PR-only automation.

## A real-world example

`examples/sbf/` contains a sanitized, real production configuration from Second Brain Factory — an 8-subsystem Vite + Vercel + Stripe + Postgres app that has run thousands of tasks through Yalla. The matching real eval fixtures live in `eval/yalla/data/*.json` (drawn from that project's incidents and PRDs) as the worked dataset behind the proof checks. It shows what a mature `YALLA.md`, a project-specific check file, and real proof fixtures look like. Use it as a reference, not a starting point.

## License

MIT — see [LICENSE](LICENSE).
