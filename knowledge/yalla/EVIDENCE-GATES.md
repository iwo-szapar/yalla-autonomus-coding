# Portable Evidence Gates

Use these gates only when their trigger applies. They make review evidence generative: the agent must enumerate the relevant siblings, trust boundaries, capacity limits, or lifecycle states instead of answering a generic yes/no question.

## External grounding

Trigger: the planned behavior relies on an external API, SDK, protocol, browser/provider/platform behavior, or generated setup instructions.

Write `.pipeline/external-grounding.json` before implementation. Record current official/upstream sources, the precise claims used, access date, and the implementation consequences. If evidence is unavailable or conflicts, record `inconclusive`; the affected promise cannot support `PROVEN`.

## Runtime E2E preflight

Trigger: a run claims preview, staging, production, remote, or other real-environment proof.

Write `.pipeline/runtime-e2e-preflight.json` before the run. It must include the target/base revision, required environment and data shape without secret values, mutation guardrails, inherited baseline failures, skip classification, and exact `proves` / `does_not_prove` lists.

Classify skips as `intentional-guard-skip` or `unresolved-proof-gap`. The latter blocks `PROVEN`; the former is valid only when the PR does not claim the skipped behavior.

## Generative review gates

| Gate | Trigger | Required enumeration |
| --- | --- | --- |
| Surface parity | New or ported API, CLI, job, webhook, cron, or public entrypoint | At least two siblings plus auth, rate limits, error taxonomy, telemetry, time budgets, and headers applied or explicitly diverged |
| Trust map | Untrusted input is consumed or an artifact/export/rendered output is emitted | Each input writer, hostile status, neutralization; each output’s consuming execution context and escaping/guard |
| Volume envelope | Per-item external calls or collection reads | Busiest realistic case, cost math, pagination/concurrency/time bound, explicit truncation behavior |
| Lifecycle states | Stateful provider, token/access grant, entitlement, or money-adjacent object | Each object’s consumed states, behavior per state, and a negative test |

Use a concrete N/A reason when a gate does not apply. Never invent a generic concern list just to satisfy the gate.

## UI proof

For a user-visible UI claim, preserve a revision-bound assertion list and private/local screenshots, traces, or a short recording when they materially prove the behavior. Do not upload captures to a public anonymous host by default. Exclude secrets, customer data, payment details, and tokens; record an untested condition instead of exposing them.

## Ratchet rule

When the same prose review rule catches a real defect twice, propose the smallest deterministic guard: a source check, lint rule, contract test, or fixture. Keep the new check only when it prevents the failure without broadening unrelated work; then remove or narrow the duplicated prose rule.
