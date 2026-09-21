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
  visual: "<run-state>/visual-evidence/"
```

These entries are hints for planning and reporting. They do not run automatically from `yalla:run`; the agent must still execute the right verifier and record the evidence.

## Goal Contract Mapping

Each `goal-contract.json` should name the required evidence. Map each item to one or more verifiers before implementation starts.

Good evidence:

- `npm test` passes for the public route test.
- Playwright screenshot saved to `<run-state>/visual-evidence/dashboard-after.png`.
- Benchmark JSON shows p95 latency did not regress.
- Independent evaluator returns `PASS` after reading the goal contract and artifacts.

Weak evidence:

- "Looks good."
- "The code compiles in my head."
- Model-only judgment for a route, payment, auth, migration, or deterministic UI state.

## Evaluator Separation

The executor writes code and implementation notes. The evaluator reads only:

- `<run-state>/goal-contract.json`
- changed files or diff summary
- deterministic verifier outputs
- visual/benchmark artifacts
- `<run-state>/evaluator-results.json` history when rerunning

The evaluator returns `PASS`, `FAIL`, or `INCONCLUSIVE` plus findings and next
instruction, bound to the active candidate. `FAIL` also declares a failure
class. Only `CANDIDATE_FAILURE` loops back to implementation; baseline,
infrastructure, identity, policy, and superseded results follow their distinct
stop/retry/discard actions. `INCONCLUSIVE` asks for stronger evidence or human
input.

## Artifacts

- Goal contract: `<run-state>/goal-contract.json`
- Candidate identity: `<run-state>/candidate.json`
- Inherited baseline: `<run-state>/baseline.json`
- Evaluator results: `<run-state>/evaluator-results.json`
- Loop state: `<run-state>/loop-state.json`
- Session mining: `<run-state>/session-mining-report.json`
- Visual evidence: `<run-state>/visual-evidence/*.{png,jpg,jpeg,webp,gif,svg}`
- Benchmarks: `<run-state>/benchmarks.json`
- Operation telemetry and idempotency: `<run-state>/operation-receipts.json`; require `local-configured-capability` for locally authorized routine actions and `none-local-telemetry-only` for protected-action mirrors, which are never execution authority
- Remote build/job cost evidence: `<run-state>/remote-jobs.json`
