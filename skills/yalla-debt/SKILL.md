---
name: yalla-debt
description: >
  Scan the repo for intentional minimum-diff simplification markers and report
  the deferred complexity ledger. Use when the user says yalla debt, shortcut
  ledger, what did we defer, list simplifications, or /yalla-debt.
argument_hint: "[optional: directory, file, or --with-blame]"
---

# /yalla-debt

Report deliberate simplifications so "add later" does not become invisible debt. Apply nothing unless the user explicitly asks to persist a ledger file.

## Markers

Scan tracked source for comment markers, skipping `.git`, `node_modules`, `.pipeline`, `dist`, `build`, coverage, generated assets, and vendored dependency folders:

- `yalla-min:`
- `minimum-diff:`

Prefer `rg -n "(yalla-min:|minimum-diff:)"`.

Each marker should name:

- the simplification or ceiling,
- why it is safe now,
- the trigger to revisit it, usually phrased as `add when`, `upgrade when`, or `revisit when`.

Good:

```ts
// yalla-min: process-wide lock is safe for local CLI runs; upgrade when parallel workers run against one repo.
```

Weak:

```ts
// yalla-min: use a simple lock for now.
```

## Output

Group by file:

`path:Lx: <marker> <simplification>. why safe now: <reason or missing>. add when: <trigger or no-trigger>.`

Flag any marker without a concrete revisit trigger as `no-trigger`.

End with:

`<N> markers, <M> no-trigger.`

If nothing is found:

`No yalla-min debt. Clean ledger.`

## Boundaries

- Read and report only.
- Do not count ordinary TODOs as Yalla debt unless they use one of the markers.
- Do not ask to remove simplifications that are still inside the recorded minimum-diff budget.
- Do not persist a ledger file unless the user asks for one.
