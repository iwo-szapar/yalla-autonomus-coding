---
name: yalla-simplify
description: >
  Review the current diff only for avoidable complexity and minimum-diff violations. Finds what to delete, replace with stdlib/native/existing code, or shrink. Use when the user says simplify, over-engineered, what can we delete, minimum diff, or /yalla-simplify.
argument_hint: "[optional: files, diff base, or focus area]"
---

# /yalla-simplify

Complexity-only review. Do not review correctness, security, product strategy, or test completeness except where they prove the diff cannot be simplified. The best finding deletes code.

## Inputs

Default base is `$BASE_BRANCH` from `.claude/YALLA.md` or `main`.

Gather:

```bash
git diff "$BASE_BRANCH" --name-only
git diff "$BASE_BRANCH"
```

Read `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/MINIMUM-DIFF.md` and `${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/REVIEW-CHECKS.md` before judging.

If `.pipeline/classification.json` exists, inspect `minimum_diff_decision` and compare the diff to its selected rung, file budget, LOC budget, reuse targets, and skipped complexity.

## Hunt

- `delete:` dead code, unused flexibility, speculative feature, duplicate path, or wrapper that only delegates.
- `existing:` new code that should reuse an existing local function, component, command, route, template, or test helper.
- `stdlib:` hand-rolled behavior the standard library already ships.
- `native:` code or dependency doing what the platform, browser, database, shell, framework, or host already does.
- `dependency:` new dependency where stdlib/native/existing code is enough.
- `yagni:` abstraction with one implementation, config nobody sets, future-proofing without a second case, compatibility shim for unshipped behavior.
- `shrink:` same behavior in fewer lines without losing clarity or edge-case correctness.
- `budget:` diff exceeds the recorded minimum-diff budget without a documented reason.

## Format

One line per finding:

`path:Lx-Ly: <tag> <what to cut>. <replacement>.`

End with:

`net: -<N> lines, -<M> deps possible.`

If there is nothing meaningful to cut:

`Lean already. Ship.`

## Boundaries

- Do not apply fixes unless the user asks.
- Do not flag one focused behavior test as bloat.
- Do not ask for a simpler version that weakens the proof contract.
- Do not ask to remove security, validation, accessibility, or data-loss handling.
- If a simplification changes behavior, name the acceptance criterion it would drop. That is usually not a valid simplification.
