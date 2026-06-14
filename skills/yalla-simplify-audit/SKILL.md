---
name: yalla-simplify-audit
description: >
  Whole-repo audit for avoidable complexity, dead abstractions, custom stdlib/native behavior, unnecessary dependencies, and minimum-diff opportunities. Use when the user says audit for bloat, repo simplify audit, what can we delete, or /yalla-simplify-audit.
argument_hint: "[optional: directory or subsystem]"
---

# /yalla-simplify-audit

Repo-wide complexity audit. Rank findings by deleted maintenance burden, not cleverness. Apply nothing.

## Scope

If the user gives a directory or subsystem, stay there. Otherwise scan the repo excluding generated/runtime directories such as `node_modules`, `.git`, `.pipeline`, `dist`, `build`, and vendored assets.

Read `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/MINIMUM-DIFF.md` first.

## Hunt

- Unused files, exports, flags, config, scripts, or compatibility paths.
- Pass-through wrappers and one-method service layers.
- Interfaces or abstract classes with one implementation and no test substitute.
- Helpers with one caller where inline code is clearer.
- Hand-rolled stdlib/native behavior.
- Dependencies used for one small feature the platform already covers.
- Parallel implementations of the same workflow.
- Tests that only verify mocks or private internals when a public seam exists.

## Output

Rank biggest cut first:

`<tag> <what to cut>. <replacement>. [path]`

Tags: `delete`, `existing`, `stdlib`, `native`, `dependency`, `yagni`, `shrink`, `test-seam`.

End with:

`net: -<N> lines, -<M> deps possible.`

If nothing meaningful appears:

`Lean already. Ship.`

## Boundaries

- Do not apply fixes.
- Do not report correctness/security/performance bugs unless the fix is deletion or simplification.
- Do not count essential validation, accessibility, error handling, or deterministic proof as bloat.
- Prefer 5 high-confidence cuts over a long speculative list.
