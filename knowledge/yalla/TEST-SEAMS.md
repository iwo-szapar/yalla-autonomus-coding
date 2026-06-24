# Test Seams

Tests should verify behavior through public interfaces. The interface is the test surface.

## Correct Seam Hierarchy

Choose the highest seam that exercises the real behavior:

1. User flow / browser flow when UI behavior matters.
2. API endpoint when the contract is HTTP.
3. Tool/command when the behavior is exposed through an agent/CLI tool surface.
4. Public library function when callers use it directly.
5. Internal helper only when the helper is itself the durable public interface inside the repo.

## Browser-Interaction Regressions

When the behavior is only visible in a real browser, the browser is the seam. Prefer Playwright, Cypress, browser-use, or an equivalent harness over component tests for regressions involving:

- continuous typing while autosave/status text changes,
- caret position, focus retention, or selection stability,
- optimistic updates and stale cache writes,
- SPA navigation away/back and reload durability,
- console errors, network failures, or request ordering visible during a journey.

Turn manual repro notes into assertions. Example:

```text
Manual note: Type through "Saving..." -> "Saved", then navigate away/back and reload.
Browser proof: type a unique string, assert the input value never reverts, assert activeElement/caret stays in the editor when supported, wait for Saved, navigate away/back, reload, assert the persisted text remains, and fail on unexpected console errors.
```

If the repo has no browser automation infrastructure and adding it is out of scope, record `manual-smoke` evidence or `TEST_SEAM_BLOCKED`. Do not downgrade the claim to a shallow render test that cannot observe the regression.

## Good Tests

- Assert observable behavior, not call order.
- Use public interfaces only.
- Mock only system boundaries: third-party APIs, email/SMS providers, version-control hosts, time, randomness, filesystem when needed.
- Use local substitutes where available instead of mocks.
- Survive refactors that preserve behavior.

## Bad Tests

- Mock internal modules you control.
- Assert private function calls or implementation ordering.
- Query the database directly when a public getter exists.
- Test only that code compiles or a component renders without asserting behavior.
- Replace a browser-only regression with a component render test that cannot observe caret, focus, navigation, or persistence behavior.

## TEST_SEAM_BLOCKED

If no correct seam exists, do not fake confidence with a shallow test. Report:

```text
TEST_SEAM_BLOCKED
Behavior: [what needs testing]
Why no correct seam exists: [specific reason]
Risk if shipped: [failure mode]
Architecture finding: [seam/deepening needed]
```

The lead must either add a seam, adjust the plan, or ask the user to accept the risk before shipping.
