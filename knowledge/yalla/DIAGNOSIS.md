# Diagnosis Protocol

Use this before planning fixes for bugs, regressions, and performance issues. The goal is a fast pass/fail feedback loop that proves the symptom exists and proves the fix worked.

## Phase 1: Build The Feedback Loop

Try these in order until one works:

1. Failing test at the highest seam that reaches the bug.
2. HTTP/curl script against a local dev server.
3. CLI invocation with fixture input and expected output.
4. Browser script that asserts DOM, console, or network behavior.
5. Captured request/payload replayed through the code path.
6. Throwaway harness around the smallest real module path.
7. Stress loop for flaky bugs.

For performance regressions, the loop must include a measurement baseline.

## Phase 2: Reproduce

Do not proceed until:

- The loop produces the user-reported symptom, not a nearby failure.
- The loop is deterministic enough to debug, or the reproduction rate has been raised for flaky bugs.
- The exact symptom is captured in `<run-state>/diagnosis.json`.

## Phase 3: Hypothesize

Generate 3-5 ranked hypotheses before changing code.

Each hypothesis must be falsifiable:

```text
If X is the cause, then changing or measuring Y will make Z happen.
```

## Phase 4: Instrument

Probe one hypothesis at a time. Debug logs must use a unique prefix such as `[DEBUG-issue-###]` and must be removed before shipping.

## Phase 5: Fix And Regress

Write or preserve the regression test at the correct seam before applying the fix. If no correct seam exists, record `TEST_SEAM_BLOCKED` and treat it as an architecture finding.

## Artifact

Write `<run-state>/diagnosis.json`:

```json
{
  "symptom": "what the user reported",
  "loop": "command or test name",
  "reproduced": true,
  "hypotheses": [
    {"rank": 1, "cause": "...", "prediction": "...", "result": "confirmed|rejected|untested"}
  ],
  "regression_test": "path or TEST_SEAM_BLOCKED",
  "debug_prefix_removed": true
}
```
