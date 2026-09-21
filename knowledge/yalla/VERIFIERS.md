# Verifiers

Verifiers are the boundary of trust for long-running Yalla runs. Executor prose is never proof by itself. A verifier is an external check, artifact, or independent evaluator that can say whether the goal contract is satisfied.

## Selection Order

Prefer verifiers in this order:

1. Deterministic project command: test, typecheck, build, lint, benchmark, smoke script.
2. Public-seam probe: API request, browser journey, CLI transcript, MCP tool call.
3. Static artifact: generated file, migration diff, manifest, snapshot, contract JSON.
4. Visual evidence: screenshot, before/after image, trace, accessibility snapshot.
5. Independent evaluator: LLM or human judgment over goal contract plus artifacts.

Do not use an independent evaluator when a deterministic verifier can express the success condition.

## `YALLA.md` Registry

Projects can document verifier commands or artifact expectations with a `verifiers:` block:

```yaml
verifiers:
  api: "npm test -- tests/api"
  ui: "npm run test:e2e"
  perf: "npm run benchmark"
  docs: "npm run docs:check"
  visual: ".pipeline/visual-evidence/"
```

These entries are hints for planning and reporting. They do not run automatically from `yalla:run`; the agent must still execute the right verifier and record the evidence.

## Goal Contract Mapping

Each `goal-contract.json` should name the required evidence. Map each item to one or more verifiers before implementation starts.

Good evidence:

- `npm test` passes for the public route test.
- Playwright screenshot saved to `.pipeline/visual-evidence/dashboard-after.png`.
- Benchmark JSON shows p95 latency did not regress.
- Independent evaluator returns `PASS` after reading the goal contract and artifacts.

Weak evidence:

- "Looks good."
- "The code compiles in my head."
- Model-only judgment for a route, payment, auth, migration, or deterministic UI state.

## Evaluator Separation

The executor writes code and implementation notes. The evaluator reads only:

- `.pipeline/goal-contract.json`
- changed files or diff summary
- deterministic verifier outputs
- visual/benchmark artifacts
- `.pipeline/evaluator-results.json` history when rerunning

The evaluator returns `PASS`, `FAIL`, or `INCONCLUSIVE` plus findings and next
instruction, bound to the active candidate. `FAIL` also declares a failure
class. Only `CANDIDATE_FAILURE` loops back to implementation; baseline,
infrastructure, identity, policy, and superseded results follow their distinct
stop/retry/discard actions. `INCONCLUSIVE` asks for stronger evidence or human
input.

## Artifacts

- Goal contract: `.pipeline/goal-contract.json`
- Candidate identity: `.pipeline/candidate.json`
- Inherited baseline: `.pipeline/baseline.json`
- Evaluator results: `.pipeline/evaluator-results.json`
- Loop state: `.pipeline/loop-state.json`
- Session mining: `.pipeline/session-mining-report.json`
- Visual evidence: `.pipeline/visual-evidence/*.{png,jpg,jpeg,webp,gif,svg}`
- Benchmarks: `.pipeline/benchmarks.json`
- Operation telemetry and idempotency: `.pipeline/operation-receipts.json`; require `local-configured-capability` for locally authorized routine actions and `none-local-telemetry-only` for protected-action mirrors, which are never execution authority
- Remote build/job cost evidence: `.pipeline/remote-jobs.json`
