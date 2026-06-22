# Requirement Court

Requirement Court is a lightweight pre-implementation challenge for work where
the requirement itself may be wrong, incomplete, oversized, or risky. It exists
to improve the goal before code changes begin.

Use it for non-tiny work, ambiguous work, autopilot-selected work, high-risk
surfaces, cross-domain changes, public commitments, and agent workflow changes.
Skip it only for tiny low-risk fixes with clear acceptance criteria.

## Artifact

Write the court result after the run has a canonical `issue-###` to:

```text
.pipeline/requirement-court.json
```

Validate the structure against:

```text
${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/schemas/requirement-court.schema.json
```

Use this example as the minimal shape:

```text
${CLAUDE_PLUGIN_ROOT}/knowledge/yalla/examples/requirement-court.example.json
```

## Modes

Use the strongest mode the runtime can honestly provide:

- `independent-review` - separate reviewers or agents produce role findings
  without seeing each other's drafts.
- `single-agent-structured` - one agent runs the roles in sequence and marks the
  artifact honestly as a single-agent court.
- `static-advisor` - a static checklist is used because no interactive review
  runtime is available.

Do not claim independent review when only one agent or one pass produced the
artifact.

## Roles

Run these roles before implementation:

- `product` asks whether the request solves a real user or operator problem,
  whether the proposed scope is the smallest valuable scope, and whether the
  acceptance criteria can prove the promise.
- `project` asks whether the work fits the current constraints, timeline,
  branch policy, rollout plan, ownership boundaries, and review cost.
- `engineering` asks whether the implementation path is technically coherent,
  local, reversible, and aligned with existing architecture.
- `testing` asks whether success and false-success cases can be proven through
  deterministic seams, smoke checks, or explicit manual evidence.
- `judge` accepts the resulting requirement, amends it, rejects it, or blocks
  until missing information is supplied.

Each role votes one of:

- `approve` - the requirement is good enough for implementation.
- `amend` - implementation may proceed only after the goal contract is updated.
- `reject` - implementation must not proceed under the current requirement.

## Required Inputs

Read or create the goal contract first. The court needs:

- Raw user request or issue body.
- Desired end state.
- Acceptance criteria, including at least one negative or false-success case.
- Constraints and forbidden shortcuts.
- Evidence required before ship.
- Known risks, ownership boundaries, and rollback posture.

If these inputs do not exist, create or resume the GitHub issue and then create
`.pipeline/goal-contract.json` or an equivalent issue-body section before
running the court.

## Blocking Rules

- Any `reject` vote blocks implementation.
- Any `amend` vote requires updating the goal contract before implementation.
- A missing deterministic proof path blocks a `PROVEN` outcome until resolved or
  explicitly accepted as `INCONCLUSIVE`.
- Human confirmation is required before implementation when the work touches
  money, access, customer/user data, outbound communication, destructive action,
  public commitments, or high-risk product policy.
- If the court cannot run, record why in `.pipeline/requirement-court.json` and
  ask for an explicit risk acceptance before continuing.

## Flow

1. Classify the task and decide whether Requirement Court is required.
2. Create or resume the canonical `issue-###`.
3. Create or refresh `.pipeline/goal-contract.json`.
4. Run the role challenge in the selected mode.
5. Write `.pipeline/requirement-court.json`.
6. If any role amends the requirement, update the goal contract and record the
   amendment.
7. If the judge blocks or rejects, stop implementation and return the blocker.
8. If human confirmation is required, wait for it before implementation.
9. Continue planning only after the court decision and goal contract agree.

## Good Court Findings

Good findings are specific enough to change the plan:

- "Acceptance criterion 2 proves the happy path but not duplicate delivery;
  add a false-success criterion for duplicate webhook events."
- "The request says 'sync everything' but the smallest shippable scope is
  schema/config parity only; leave runtime automation for a follow-up issue."
- "This touches access control, so the proof plan must include a denied-user
  check and a privileged-user check."

Weak findings are vague and should be rewritten:

- "Looks good."
- "Add more tests."
- "This seems risky."

## Anti-Patterns

- Expanding scope because a role brainstormed a nice-to-have.
- Treating the court as permission to ignore the user's explicit constraints.
- Producing a court after implementation has already started.
- Hiding uncertainty by marking the judge decision as approved.
- Replacing acceptance criteria with prose summaries.
