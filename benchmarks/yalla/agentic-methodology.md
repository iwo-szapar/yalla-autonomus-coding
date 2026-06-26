# Agentic Benchmark Methodology

Yalla's benchmark should measure a real agent run against a real repo, not a single generated answer. The goal is to prove whether Yalla improves autonomous shipping without hiding incomplete work behind smaller diffs.

## Arms

- `baseline`: the same agent with no Yalla instructions, hooks, skills, or global plugins.
- `yalla`: Yalla installed exactly as users run it.
- Optional controls: a short "YAGNI/minimum diff" prompt and a terse-prose prompt.

Every arm runs in a fresh workspace, fresh agent process, and isolated plugin/config directory. Before scoring, assert that the baseline did not receive Yalla instructions.

## Task Tiers

- Feature tier: real issues against a pinned open-source repo where the agent can over-build.
- Safety tier: surgical tasks with implicit security, validation, data-loss, or accessibility requirements.
- Proof tier: tasks where a smaller diff is wrong unless evidence maps every acceptance criterion to a deterministic verifier.

## Metrics

- PR outcome: `PROVEN`, `NOT_PROVEN`, or `INCONCLUSIVE`.
- False-green rate: any run that says `PROVEN` while an acceptance criterion lacks valid evidence.
- Diff size: changed files and added source lines, excluding focused tests and evidence artifacts.
- Evidence quality: deterministic verifier coverage, public-seam tests, negative-path coverage, and model-judge misuse.
- Review quality: binary review findings caught before PR creation.
- Cost, duration, and turn count when the host exposes them.

## Scoring Rules

- Smaller code only counts when completeness and safety are preserved.
- Tests are tracked separately and never counted as bloat.
- Deterministic checks beat model judges. Use model judges only for over-engineering or completeness where no deterministic seam exists, and validate the judge with good/bad references first.
- Preserve every workspace so metrics can be recomputed offline without another agent run.

## Reproduction Checklist

1. Pin the target repo commit.
2. Run instrument self-tests before any paid agent run.
3. Clear user/global plugins from the baseline.
4. Run each task/arm in an isolated workspace.
5. Score from `git diff`, `.pipeline/outcome-evaluation.json`, and raw verifier output.
6. Publish per-task tables, limitations, and contamination checks.
