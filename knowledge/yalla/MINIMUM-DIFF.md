# Minimum Diff Gate

Yalla must prove the user-visible promise with the smallest safe diff. This gate runs after task classification and before planning so scope is reduced before code exists.

Minimum diff means fewer owned behaviors, fewer files, and fewer future obligations. It does not mean weaker proof, skipped validation, or ignored user requirements.

## Ladder

Stop at the first rung that safely satisfies the request:

1. **No-build:** The requested outcome is already true, obsolete, or better handled by explaining the existing path.
2. **Config/docs:** A project setting, docs correction, runbook, or issue clarification satisfies the need without product code.
3. **Existing code path:** An existing function, component, command, route, template, or workflow can be reused directly.
4. **Standard library/native platform:** The language, browser, database, shell, framework, or hosting platform already provides the behavior.
5. **Installed dependency:** A dependency already in the repo solves it without introducing a new package or wrapper layer.
6. **One local change:** One file or one small local edit satisfies the promise.
7. **New implementation:** Only now write new code, and only the minimum code needed for the approved acceptance criteria.

If two rungs both work, choose the higher rung. If two implementations on the same rung are similar size, choose the one that is more correct at edge cases.

## Output

Record the decision in `.pipeline/classification.json` and `.pipeline-state.json`:

```json
{
  "minimum_diff_decision": {
    "selected_rung": "no-build|config-docs|existing-code|stdlib-native|installed-dependency|one-local-change|new-implementation",
    "why_higher_rungs_failed": ["..."],
    "reuse_targets": ["src/path.ts", "docs/path.md"],
    "new_dependency_allowed": false,
    "files_budget": 3,
    "loc_budget": 120,
    "skipped_complexity": [
      {
        "item": "custom cache class",
        "why_safe_to_skip": "single caller and no measured latency issue",
        "add_when": "profiling shows repeated remote calls dominate runtime"
      }
    ]
  }
}
```

For tiny-hotfix work, the minimum-diff record can be summarized in the PR body instead of committed as an artifact.

## Planning Requirements

Every non-tiny plan must include a `Minimum Diff Gate` section with:

- Selected rung.
- Existing files, APIs, native features, or dependencies checked.
- Scope explicitly skipped.
- File and LOC budget for the first PR.
- Upgrade path for intentional simplifications.

If the selected rung is `new-implementation`, the plan must name why `existing-code`, `stdlib-native`, and `installed-dependency` do not satisfy the request.

## Allowed Shortcuts

Intentional simplifications are allowed when they preserve the success invariant. Mark them in the plan and PR, not necessarily in code.

Use a short code comment only when future maintainers could mistake the simplification for ignorance:

```ts
// yalla-min: process-wide lock is enough for local CLI runs; use per-repo locks if parallel workers arrive.
```

## Never Minimize Away

- Input validation at trust boundaries.
- Auth, access, privacy, and secret handling.
- Error handling that prevents data loss or false success.
- Accessibility basics for UI work.
- Deterministic proof when a deterministic seam exists.
- Anything the user explicitly asked to keep.

## Review Hook

The complexity review must compare the final diff against `minimum_diff_decision`. A larger diff is acceptable only when implementation evidence shows the budget was wrong and the plan or PR explains the change.
