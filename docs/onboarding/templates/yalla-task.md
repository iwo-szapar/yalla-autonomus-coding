---
name: Yalla Task
about: A well-scoped task for a Yalla run
title: ""
labels: "yalla-ready,p2"
assignees: ""
---

## Intent

What should be true for the user, operator, developer, or system after this ships?

## Acceptance Criteria

- [ ] Concrete observable behavior
- [ ] Negative or false-success path, if relevant
- [ ] Docs/config updates, if relevant

## Context

Relevant files, screenshots, logs, PRs, incidents, or decisions.

## Constraints

Known non-negotiables, risky areas, or things not to change.

## Verification

Commands or manual checks a human would run.

## Browser Repro

For browser-facing issues, include exact steps and expected state. Example:

1. Go to the affected page.
2. Type continuously while save/status text changes.
3. Navigate away and back.
4. Reload and confirm persisted state.

Expected: typed text is not lost or reverted, caret/focus stays stable, no unexpected console/network errors occur, and saved state survives navigation/reload.

## Autopilot Notes

- Leave `yalla-ready` only if this issue is eligible for queue dry-run selection.
- Add `blocked`, `needs-human`, or `do-not-autopilot` if automation should skip it.
- Use `risk:high` for payments, auth, migrations, security, broad refactors, or irreversible side effects.
