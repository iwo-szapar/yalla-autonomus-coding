# Yalla Benchmarks

These benchmarks measure whether Yalla improves agent shipping quality without bloating the diff. They are intentionally fixture-based until enough public run data exists for automated replay.

## Scenarios

- `tiny-hotfix`: one-file fix with focused reproduce/fix/verify evidence.
- `bug-repro`: bug report requiring diagnosis before implementation.
- `small-feature`: one vertical user-testable slice.
- `high-risk-async`: webhook/job-style fixture requiring strict proof and risk-triggered review.

## Metrics

- False-done rate: runs that claim success without `PROVEN` evidence.
- Time to PR: wall-clock time from issue selection to PR creation.
- Files changed and LOC changed.
- Acceptance criteria with deterministic evidence.
- Review failures caught before PR.
- Minimum-diff violations caught before implementation.

## Commands

```bash
npm run eval:yalla:minimum-diff
npm run eval:yalla:smoke
```

Future replay harnesses should compare at least three arms: raw agent, Yalla standard, and Yalla lean. Use the same issue text and seed fixtures across arms, and count only `PROVEN` as success.
