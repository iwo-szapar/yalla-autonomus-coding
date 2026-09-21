# Context Saving Protocol

Context saving keeps `/yalla` resumable after compaction, handoff, or a cold worktree restart. The primary durable state is `.pipeline-state.json` plus `.pipeline/*` artifacts, anchored to a unit of work identified as `issue-###`.

Saved context is not resumable merely because files exist. Run
`npm run yalla:run -- resume` and continue automatically only when the active
candidate and latest checkpoint are `RESUMABLE_EXACT`. Other states require
revalidation, a new candidate, or a stop; never reset Git automatically.

## When To Update

- After each phase completes.
- When hitting a blocker or changing approach.
- Before any context reset.
- When making a non-obvious decision.
- Before handing a phase PR or child issue to another run.

## Local State Checkpoint

Write `.pipeline-state.json` before each phase transition. This is the primary persistence layer in every tracking mode:

```json
{
  "issue_number": 123,
  "issue_id": "issue-123",
  "tracking_mode": "github",
  "github_available": true,
  "base_branch": "main",
  "branch": "session/issue-123-short-slug",
  "phase": "2-work",
  "task_type": "feature",
  "scope_mode": "HOLD",
  "required_gates": ["vertical_slices", "test_seams", "review"],
  "phase_split_required": false,
  "risk_tier": "medium",
  "evidence_mode": "standard",
  "architecture_doc_gate": "applies",
  "architecture_doc_gate_reason": "Changed a flow documented in the project's architecture docs",
  "merge_policy": "pr-only",
  "plan_file": "plans/active/issue-123-short-slug.md",
  "test_status": "pending",
  "updated_at": "2026-06-08T10:00:00Z"
}
```

`base_branch` mirrors `$BASE_BRANCH` from `.claude/YALLA.md` (`base_branch`, default `main`). `issue_id` is `issue-###` in both `github` and `file-only` modes. Never introduce a new `task_id` field.

## Durable Handoff Locations

- GitHub issue body/comment (github mode): Agent Brief, approved plan summary, phase PR list, current blocker.
- `.pipeline/progress.md`: ephemeral handoff notes for active worktrees.
- PR body/comment: validation evidence, CI status, accepted risks, and review entry points.
- Your project's conventions doc (`CLAUDE.md` / `AGENTS.md`), `.claude/YALLA.md`, or `docs/learnings/*`: durable rules only when the run exposed a reusable directive.

## Recovery Protocol

1. Read `.pipeline-state.json` for issue number, branch, phase, classification, and merge policy.
2. Read `plans/active/issue-###-[slug].md` for the approved plan.
3. Read the GitHub issue body/comments for Agent Brief, blockers, and PR links (github mode). In file-only mode, the plan file and `.pipeline/progress.md` hold this context.
4. Read `.pipeline/progress.md`, `.pipeline/acceptance-trace.json`, `.pipeline/architecture-alignment.json`, `.pipeline/test-evidence.json`, and `.pipeline/review-results.json` when present.
5. Resume from the recorded phase.

## Cleanup

Keep `.pipeline-state.json` local unless it is intentionally useful review evidence. Do not commit a follow-up artifact update just to record PR number or final CI status; put that evidence in the PR body or PR comments.

## DB Mode Note (optional)

If `tracking_mode: db`, durable session context (e.g. a `description_full` column) and inter-agent findings (e.g. a `pipeline_memories` table) may persist in a database instead of issue comments. This is an advanced path — see `knowledge/yalla/SQL-TEMPLATES.md`. GitHub-Issues mode and file-only mode need no database.
