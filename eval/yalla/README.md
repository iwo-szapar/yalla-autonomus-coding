# Yalla Proof-Contract Evals

This directory defines the V0 proof contract for a single `/yalla` run. It does not run autopilot, queue work, schedule jobs, or change OpenCode permissions.

> The bundled fixtures and `test-inventory.json` are **real-world examples** from the Second Brain Factory (SBF) engineering repo, kept as the worked example dataset. The engine code is generic; only the fixture content is SBF-specific. Replace `<owner>/<repo>` references with your own repo (or set the `YALLA_REPO` environment variable for the autopilot).

## Contract

A run is valid only when it records:

- Concrete issue intent and user-visible promise.
- Acceptance criteria before implementation, including at least one negative or false-success path.
- A proof mode for every criterion.
- Deterministic proof whenever a deterministic seam exists.
- Implementation evidence and passing commands for `PROVEN` outcomes.
- Required review checks with passing verdicts before `PROVEN`.
- Review-triggered reruns when review causes edits.
- Final verdict of exactly `PROVEN`, `NOT_PROVEN`, or `INCONCLUSIVE`.

`INCONCLUSIVE` is allowed for PR creation, but it is not success and cannot count toward proven state.

## Commands

```bash
npm run eval:yalla:proof-contract
npm run eval:yalla:test-inventory
npm run eval:yalla:minimum-diff
npm run eval:yalla:plan-quality
npm run eval:yalla:review-quality
npm run eval:yalla:test-coverage
npm run eval:yalla:plan-review-coverage
npm run eval:yalla:outcome-quality
npm run eval:yalla:smoke
npm run yalla:autopilot -- run --issue issue-### --mode dry-run
npm run yalla:autopilot -- queue --mode dry-run
npm run yalla:benchmark
```

The proof-contract command prints a JSON report showing:

- Before patch: P0 legacy samples fail the strict contract.
- After patch: P0 patched samples pass.
- Held-out samples keep `INCONCLUSIVE` from becoming success.

The test-inventory command validates `eval/yalla/test-inventory.json` and its fixtures. It enforces:

- Payment, auth/security, async jobs, generated artifacts, UI journeys, and schema/migration categories are represented.
- Each category maps to existing tests or explicit coverage gaps.
- Missing or weak verification commands are `NOT_PROVEN` or `INCONCLUSIVE`, never `PROVEN`.
- Model judges are forbidden when deterministic seams exist.
- Fixture sealed rubrics are removed before evaluation.
- Likely secrets are rejected.

The minimum-diff command validates the pre-plan scope-reduction gate. It rejects:

- new dependencies where stdlib/native or existing code was not checked,
- one-use abstractions without a second real case or explicit simplification note,
- implementation plans that skip required higher rungs,
- over-budget file or LOC growth without updating the minimum-diff decision.

The plan/review/coverage commands validate the PRD 03 fixtures:

- `plan-quality` rejects all-history incident/learnings scans and accepts relevant-subsystem scans.
- `review-quality` catches missed Zod/interface drift.
- `test-coverage` rejects model-judge-only proof when a deterministic seam exists.

The outcome-quality command validates the PRD 04 proving-ground runs:

- Five unique real GitHub issues and PRs are required.
- Completed PRs are scored from issue intent, plan, acceptance trace, test evidence, review results, PR checks, and optional browser evidence.
- `PROVEN` is the only success verdict. `NOT_PROVEN`, `INCONCLUSIVE`, missing PR checks, failed commands, and failed review checks fail the gate.

The smoke command runs all eval suites and fails if any suite fails.

The autopilot loop-lite command validates the single-issue local dry-run path. It checks GitHub auth, probes one canonical `issue-###`, writes `.pipeline/autopilot-state.json` and `.pipeline/loop-telemetry.json`, and does not mutate GitHub in dry-run mode. The target repo is resolved from `YALLA_REPO`, then `gh repo view`, then a documented `<owner>/<repo>` placeholder.

The queue dry-run validates report-only queue selection. It lists open issues with the eligibility label, skips block-labeled issues, writes `.pipeline/autopilot-queue-report.json`, and does not mutate GitHub.

Scheduled or unattended operation is outside the V0 eval contract. Use `docs/autopilot/README.md` and `docs/autopilot/readiness-checklist.md` to graduate from local dry-run to report-only, assisted PR, or unattended PR modes.

## Fixture Sources

The fixture `source` fields cite the original SBF incidents, learnings, and PRDs that each regression guards. They are kept verbatim as the worked example dataset:

- `zod_interface_drift_review_gap`: `docs/incidents/2026-04-16-yalla-review-gap.md`
- `checkout_surface_parity_missing`: `docs/learnings/2026-05-06-checkout-surface-parity.md`
- `deterministic_seam_model_judge_only`: proof-mode rule from PRD 01.
- `date_format_new_dependency_rejected`: minimum-diff guard against dependency/abstraction bloat.
- `one_implementation_interface_rejected`: minimum-diff guard against single-use interfaces.
- `missing_evidence_false_success`: honest-outcome rule from PRD 01.
- `heldout_inconclusive_never_success`: held-out regression guard for `INCONCLUSIVE` handling.
- `plan_relevant_subsystem_scan`: PRD 03 guard against all-history scan requirements.
- `review_zod_interface_drift`: PRD 03 guard for review missing Zod/interface drift.
- `test_coverage_deterministic_seam_model_judge`: PRD 03 guard against model-judge-only deterministic proof.
- `2026-06-09-proven-state`: PRD 04 guard that five real staging PRs are `PROVEN`, not `INCONCLUSIVE`.

## Test Inventory Categories

- `payment`
- `auth-security`
- `async-jobs`
- `generated-artifacts`
- `ui-journeys`
- `schema-migration`
