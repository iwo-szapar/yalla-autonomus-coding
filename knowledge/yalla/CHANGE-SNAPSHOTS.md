# Change Snapshots

Change Snapshots are lightweight, risk-gated records of important mutations.
They are not a full backup system and they do not replace version control. They
exist to make high-risk changes reviewable, auditable, and reversible enough for
a human to understand what changed and why.

Use snapshots only for mutation groups where the rollback, blast radius, or
verification burden is higher than an ordinary code edit.

## Artifact

Write JSONL entries under:

```text
.pipeline/change-ledger/
```

One file per issue or run is enough for most work:

```text
.pipeline/change-ledger/issue-123.jsonl
```

Validate each entry against:

```text
${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/schemas/change-snapshot.schema.json
```

Use this example as the minimal shape:

```text
${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/examples/change-snapshot.example.jsonl
```

## Trigger Matrix

Create pre/post entries for mutation groups that touch:

- Database schema, migrations, seed data, retention, or destructive data changes.
- Payments, billing, refunds, invoices, plans, entitlements, or webhooks.
- Authentication, authorization, sessions, identity, roles, permissions, or
  access-control policy.
- Email, SMS, push, Slack, webhooks, or any outbound communication.
- AI prompts, model routing, evaluators, agent workflow policy, or generated
  artifact behavior.
- Bulk mechanical edits, generated files, codegen templates, codemods, or
  package/lockfile changes with broad blast radius.
- Pipeline configuration, CI/CD, deployment, release, scheduled jobs, or
  autopilot/run-control behavior.
- Security-sensitive files, secrets handling, dependency upgrades, or network
  boundary changes.

Do not create snapshots for tiny low-risk edits unless the user or local config
requires them.

## Entry Phases

Use these phases:

- `before_mutation` - record intent, affected files, pre-change hashes when
  practical, expected behavior, and planned verification before editing.
- `after_mutation` - record the same mutation group after editing, including
  post-change hashes and the verification command plan.
- `verification` - record the command/test/smoke outcome when it is not already
  captured in another run artifact.
- `rollback_plan` - record manual rollback instructions when the mutation cannot
  be safely reverted by a simple git revert.
- `exception` - record why a required snapshot could not be captured.

## Safety Rules

- Never copy secrets, `.env` values, API keys, private certificates, tokens,
  raw production data, or private customer/user content into the ledger.
- Do not store large or binary file contents. Use relative paths, hashes,
  summaries, and commands instead.
- Prefer SHA-256 hashes for file states; use `null` only when the file does not
  exist in that phase or hashing would be unsafe.
- Keep paths repository-relative.
- Snapshots are evidence, not executable rollback scripts.
- Do not automatically apply rollback instructions. Future restore flows must
  hash-check the expected pre/post states and require human confirmation for
  destructive actions.
- Redact aggressively and record the redaction category in the `redactions`
  field.

## Flow

1. During classification, map the files/subsystems likely to trigger snapshots.
2. Before each high-risk mutation group, append a `before_mutation` entry.
3. Make the smallest coherent mutation group.
4. Append an `after_mutation` entry before moving to the next group.
5. Run the planned verification and append a `verification` entry when useful.
6. If rollback is not a plain git revert, append a `rollback_plan` entry.
7. Include a concise snapshot summary in the PR body for high-risk work.

## Good Snapshot Notes

Good notes make review and rollback easier:

- "Before migration edit: `db/migrations/20260622_add_entitlements.sql` does not
  exist; `db/schema.sql` hash is recorded. Verification will run migration tests
  and a denied-entitlement API smoke."
- "After prompt policy edit: prompt template hash changed; no customer data was
  copied; eval smoke must pass before PR."
- "Rollback requires reverting migration file and running the down migration in
  staging; do not auto-apply in production."

Weak notes should be rewritten:

- "Changed stuff."
- "Looks safe."
- "Rollback with git."

## Local Tuning

Repos can tune `change_snapshots.triggers` in `.claude/YALLA.md`. Upstream Yalla
defines the reusable artifact and rules; local projects decide which domains are
high risk for their product.
