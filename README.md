# Yalla

**Give Claude Code a one-line task. Get back a tested, reviewed pull request.**

Yalla is an autonomous coding pipeline for [Claude Code](https://claude.com/claude-code). It turns a description into a planned, built, tested, reviewed, and shipped PR — using specialized agents and adaptive ceremony, **grounded in a project knowledge base** (your gotchas, risk checks, and architecture) and **held to a Proof Contract that a built-in eval harness grades**. A run only ships when evidence artifacts say it's proven. GitHub Issues are the default task store; Linear, file-only, and DB-backed modes are configurable for teams with different workflows.

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
| **1 · Track** | Creates or resumes the configured tracker issue (GitHub by default, Linear when configured) and a worktree branch. |
| **2 · Plan** | Researches the codebase, designs an approach, and adversarially challenges it. Bugs run a diagnosis gate first. You approve before any code is written. |
| **3 · Work** | Builds in vertical slices — each one a thin, demoable end-to-end behavior — writing a failing behavior test at the highest correct seam before the implementation that passes it. |
| **4 · Test** | Runs the suite until green, verifies every acceptance criterion maps to evidence, and records falsifiable verification (`VERIFIED` / `NOT VERIFIED` / `INCONCLUSIVE`). |
| **5 · Review** | Independent reviewers each answer **one** binary question (security? complexity? correctness?). Any Fail blocks the ship. The author never reviews their own code. |
| **6 · Compound** | Captures actionable learnings to their smallest lasting home so the same mistake isn't repeated. |
| **7 · Ship** | Writes the selected run namespace's `outcome-evaluation.json`, commits specific files, and opens a PR — PR-only by default; never auto-merges unless you asked in this run. |

The core idea: **keep the universal pipeline small, and activate risk-specific gates only when the diff touches that subsystem.** A docs typo doesn't get dragged through payment, migration, and auth review. A change to your billing code does.

## The Proof Contract

A run is "done" only when its **verdict is `PROVEN`** — and `PROVEN` is backed by artifacts, not prose. Before shipping, Yalla writes `<run-state>/outcome-evaluation.json` with a verdict of exactly one of:

- **`PROVEN`** — the acceptance trace exactly covers the goal contract, every required evidence command passes, classification gates remain armed in final review, all seven portable evidence gates have applicable/pass or concrete N/A decisions, and no remaining delta exists. Only `PROVEN` may be called done, complete, or ready to merge.
- **`NOT_PROVEN`** — evidence or review shows the promise isn't satisfied. An honest outcome, not a failure to hide.
- **`INCONCLUSIVE`** — local proof is blocked or external evidence is unavailable. Can still open a PR, but the PR clearly says human review or external evidence is needed.

Missing evidence never becomes `PROVEN`. Deterministic proof is preferred — Yalla won't lean on a model judge when a concrete test or check can verify the behavior. This is what stops "looks done" from masquerading as "is done."

When the work makes an external or real-environment claim, Yalla records the authoritative source or E2E preflight before implementation. For public surfaces, untrusted data, high-volume work, stateful provider objects, and UI claims, it activates a small generative gate: enumerate the relevant siblings, trust boundary, bounds, states, or revision-bound proof instead of replying with a generic checklist.

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

Yalla builds in **tracer-bullet vertical slices** — each slice is a thin slice of real, demoable, end-to-end behavior, not a horizontal layer (no "all the models, then all the controllers"). For every acceptance criterion it writes one **failing behavior test at the highest correct seam** — the public interface a user or caller actually hits (browser journey, route, endpoint, MCP/CLI tool, exported function) — *before* the implementation that makes it pass. Tests cross the public seam and mock only system boundaries; they don't reach into private internals just to satisfy a gate. Browser-only regressions such as lost typing during autosave, caret jumps, stale save labels, navigation durability, console errors, or failed network requests must be proven in the browser seam or recorded as `TEST_SEAM_BLOCKED`/`manual-smoke`, not replaced with a shallow render test. If no correct seam exists, the run records `TEST_SEAM_BLOCKED` and halts for a decision instead of writing a shallow test.

## `.pipeline/*` evidence artifacts

A run leaves a trail under `.pipeline/` so a reviewer can decide where to look closely instead of re-reading everything:

- `classification.json` — task type, risk tier, evidence mode, gates armed.
- `minimum_diff_decision` inside `classification.json` — selected ladder rung, reuse targets, skipped complexity, file/LOC budget.
- `events.jsonl` — append-only run timeline: phase starts, tool/command notes, human decisions, checkpoints, and ship events.
- `checkpoints/` + `latest-checkpoint.json` — resumable save points after classify, plan, each work slice, test, review, and ship.
- `goal-contract.json` — desired end state, success criteria, constraints, budget, forbidden shortcuts, and required evidence.
- `candidate.json` — immutable run identity: repository, worktree, branch, base/head SHAs, dirty fingerprint, contract, configuration, and trust-policy digests.
- `baseline.json` — candidate-bound health of the repository before implementation, kept separate from candidate failures.
- `evaluator-results.json` / `loop-state.json` — independent evaluator verdicts and long-running loop decisions.
- `operation-receipts.json` / `remote-jobs.json` — idempotent local receipts plus per-candidate build, reuse, duration, cost, and retry telemetry. They are evidence, never execution authority.
- `visual-evidence/` / `benchmarks.json` — optional screenshot, image, and benchmark evidence rendered into the local report.
- `acceptance-trace.json` — every criterion, its proof mode, and its evidence status.
- `test-evidence.json` — commands run, pass/fail, falsifiable claim verdicts, smoke evidence.
- `external-grounding.json` / `runtime-e2e-preflight.json` — conditional source grounding and environment proof boundaries.
- `review-results.json` — each binary check and its verdict.
- `intent-brief.md` / `progress.md` — what a senior reviewer needs before the diff, and the running build log.
- `outcome-evaluation.json` — the final `PROVEN` / `NOT_PROVEN` / `INCONCLUSIVE` verdict.

Artifacts are committed only when they explain non-obvious decisions, accepted risks, or review findings a reviewer needs in the diff; routine state stays local and is summarized in the PR body. Tiny hotfixes usually commit none.

## The knowledge base

The pipeline engine is generic — what makes a run *yours* is the knowledge base in [`knowledge/yalla/`](knowledge/yalla/). It's read on demand at every phase and is the difference between a generic agent and one that knows your codebase:

- **Your gotchas** — the non-obvious rules a new contributor trips on, loaded as hard constraints into every run (defined in your `YALLA.md`).
- **Review checks** ([`REVIEW-CHECKS.md`](knowledge/yalla/REVIEW-CHECKS.md)) — the binary pass/fail library, including a risk-gate set (payments, migrations, auth, async, email, generated artifacts, UI journeys, and browser interactions) that arms only when the diff touches that subsystem.
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

The queue dry-run ranks eligible issues with the `yalla-ready` label, skips block labels, and writes `.pipeline/runs/queue/autopilot/autopilot-queue-report.json` without mutating GitHub. For scheduled or unattended operation, use the staged runbook in [`docs/autopilot/`](docs/autopilot/). The default posture remains PR-only and dry-run/report-only until the readiness checklist passes.

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
- MCP-only hosts: `yalla-mcp/` exposes the compact instruction builder as a prompt/tool server without extra runtime dependencies.

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
/yalla-debt                     list yalla-min/minimum-diff shortcut markers
/yalla-audit <issue-### | PR#>  post-mortem on a completed run
/yalla issue-123                resume an interrupted run
```

Operator run-control helpers are also available from the cloned repo:

```bash
ISSUE_ID=issue-123
RUN_ID=attempt-1
RUN_STATE=.pipeline/runs/$ISSUE_ID/$RUN_ID
RUN_CONTEXT=(--pipeline-dir "$RUN_STATE" --issue-id "$ISSUE_ID" --run-id "$RUN_ID")
npm run yalla:run -- doctor "${RUN_CONTEXT[@]}"
npm run yalla:run -- goal "${RUN_CONTEXT[@]}" --message "Ship a verified healthcheck" --criterion "returns 200" --evidence "npm test"
npm run yalla:run -- candidate "${RUN_CONTEXT[@]}"
npm run yalla:run -- baseline "${RUN_CONTEXT[@]}" --message "main is green"
npm run yalla:run -- event "${RUN_CONTEXT[@]}" --event stage.started --phase plan --message "Planning started"
npm run yalla:run -- checkpoint "${RUN_CONTEXT[@]}" --phase test --message "Focused tests passed"
npm run yalla:run -- stamp "${RUN_CONTEXT[@]}" --target "$RUN_STATE/test-evidence.json"
npm run yalla:run -- stamp "${RUN_CONTEXT[@]}" --target "$RUN_STATE/outcome-evaluation.json" --input "$RUN_STATE/custom-proof.json"
npm run yalla:run -- evaluate "${RUN_CONTEXT[@]}" --evaluator reviewer --verdict PASS --message "Evidence is sufficient" --failure-class CANDIDATE_FAILURE
npm run yalla:run -- ownership "${RUN_CONTEXT[@]}"
npm run yalla:run -- operation "${RUN_CONTEXT[@]}" --operation-id open-pr-123 --capability open_pr --action open --target issue-123 --operation-status pending
npm run yalla:run -- operation "${RUN_CONTEXT[@]}" --operation-id open-pr-123 --capability open_pr --action open --target issue-123 --operation-status succeeded
npm run yalla:run -- remote-job "${RUN_CONTEXT[@]}" --operation-id suite-123-1 --job-kind full-suite --job-status reserve --artifact-action built
npm run yalla:run -- remote-job "${RUN_CONTEXT[@]}" --operation-id suite-123-1 --job-kind full-suite --job-status succeeded --artifact-action built --duration-seconds 600 --cost 1.25
npm run yalla:run -- loop "${RUN_CONTEXT[@]}"
npm run yalla:run -- status "${RUN_CONTEXT[@]}"
npm run yalla:run -- report "${RUN_CONTEXT[@]}"
npm run yalla:run -- mine-sessions "${RUN_CONTEXT[@]}"
npm run yalla:run -- resume "${RUN_CONTEXT[@]}"
npm run yalla:run -- rewind "${RUN_CONTEXT[@]}" --target plan
npm run yalla:run -- export "${RUN_CONTEXT[@]}"
```

Use one canonical `RUN_STATE` for the whole attempt. Every stateful command requires the same stable issue ID, run ID, and derived namespace; validation happens while that namespace's exclusive lock is held. Existing root `.pipeline/*` artifacts are manual, read-only legacy evidence: the runner will not select or overwrite them. These controls write only local evidence. `resume` continues automatically only when the declared repository matches the observed origin, the configured base resolves, and candidate/checkpoint lineage is exact; `rewind` selects a checkpoint but never runs destructive Git commands. The local runner deliberately refuses repository-supplied release preflight commands and all protected capabilities. An external operator-controlled executor must independently verify provider identity, run any release preflight, obtain approval, and perform consequential actions. Local operation and remote-job records are telemetry only and must never be consumed as execution authority. Non-protected capabilities must be allowed in config. A pending receipt or remote job can still be closed after candidate drift, so real outcomes do not remain stuck. Remote artifact reuse remains visible in telemetry and consumes the overall job budget, but it does not consume a full-suite or production-build execution slot.

Requires the [GitHub CLI](https://cli.github.com) (`gh auth login`) for default GitHub tracking and PR creation. If Linear is your sprint board, set `tracking_mode: linear` and map `task_system` states in `.claude/YALLA.md`; GitHub still receives branches and PRs. If you intentionally want no external tracker, set `tracking_mode: file-only`.

## Components

- **Skills** (`skills/`) — the pipeline entry points and orchestration.
- **Agents** (`agents/`) — the specialists: lead (orchestrator), implementer, tester, reviewer.
- **Knowledge** (`knowledge/yalla/`) — pipeline mechanics (classification, diagnosis, vertical slices, test seams, artifacts, agent brief, preflight) plus the customizable check definitions in `REVIEW-CHECKS.md` and `PROJECT-CHECKS.md`.
- **Eval harness** (`eval/yalla/`) — the runnable proof-contract / test-inventory / outcome-quality suites and their fixtures. Repo-root only.
- **Benchmarks** (`benchmarks/yalla/`) — methodology for agentic baseline-vs-Yalla measurement.
- **Onboarding docs** (`docs/onboarding/`) — what each repo needs: config, labels, issue shape, project checks, and eval fixtures.
- **Autopilot docs** (`docs/autopilot/`) — staged scheduler/readiness guidance for moving from local dry-run to PR-only automation.

## A real-world example

`examples/sbf/` contains a sanitized, real production configuration from Second Brain Factory — an 8-subsystem Vite + Vercel + Stripe + Postgres app that has run thousands of tasks through Yalla. The matching real eval fixtures live in `eval/yalla/data/*.json` (drawn from that project's incidents and PRDs) as the worked dataset behind the proof checks. It shows what a mature `YALLA.md`, a project-specific check file, and real proof fixtures look like. Use it as a reference, not a starting point.

## License

MIT — see [LICENSE](LICENSE).
