# Shipping Artifacts For Product Intent

Do not create a separate generic documentation tree by default. Use the smallest existing home that lets the next agent and reviewer understand intent and verify implementation.

## Durable Homes

| Intent surface | Durable home |
|---|---|
| App architecture, flows, trust boundaries | `docs/architecture/*.md` |
| API/tool contracts | `docs/reference/*.md` or equivalent |
| Operational process/runbooks | `docs/guides/*.md`, `docs/runbooks/*.md`, or equivalent |
| Product bet and validation plan | `docs/prd/*.md`, `plans/active/issue-###-*.md`, or a project template |
| Incident-derived rule | `docs/learnings/YYYY-MM-DD-*.md` or the project conventions doc only if global |
| Active run evidence | `<run-state>/*` local artifacts, committed only when review-relevant |
| Agent workflow rule | `skills/*`, `knowledge/*`, `agents/*`, or vendored `.claude/*` engine files |

## Core Artifacts

- Product Intent section in the plan.
- Acceptance trace that maps each intended behavior to evidence or accepted risk.
- Intended-vs-implemented review result when the gate applies.
- Documentation impact statement in the PR.
- Outcome evaluation that refuses to call the run proven without evidence.

## Conditional Artifacts

Add only when the capability exists or changes:

- Email behavior: update email docs/templates and include render evidence.
- Cron/job behavior: update runbook/architecture and include retry/idempotency evidence.
- Public SEO/social behavior: update routing/public docs and include public-data-only proof.
- Agent/automation behavior: document trigger, allowed tools/APIs, approval gate, output contract, audit log, and kill switch.
- Permissions/access behavior: update flow/permission docs and include deny-path evidence.

## Anti-Patterns

- Creating empty docs for capabilities that do not exist.
- Treating `<run-state>/*` as a permanent documentation system.
- Updating the project conventions doc with one-off preferences.
- Claiming docs are aligned without code evidence or test evidence.
