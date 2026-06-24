# Yalla Pre-Flight

Run this before Phase 0. It determines how task state is tracked for the run and verifies the base branch is healthy.

Yalla supports these tracking modes, declared via `tracking_mode` in `.claude/YALLA.md`:

- **`github`** (default, recommended) — GitHub Issues are the canonical task store. IDs are `issue-###`.
- **`linear`** — Linear issues are the canonical task store. IDs are tracker keys such as `CAP-123`; GitHub still hosts branches and PRs.
- **`file-only`** — no external store; state lives in `.pipeline-state.json` + `plans/`.

(A `db` mode exists for advanced setups — see the optional "DB mode" subsection below.)

## Step 1: Read configured tracking mode

Read `tracking_mode` from `.claude/YALLA.md`. If absent, default to `github`.

## Step 2: Tracker connectivity check

### GitHub mode

```bash
gh auth status
```

**If `gh` is authenticated** (and `tracking_mode` is `github`):

- Set `tracking_mode: "github"` and `github_available: true` in `.pipeline-state.json`.
- Resolve the repo:
  ```bash
  gh repo view --json nameWithOwner -q .nameWithOwner
  ```
  Store as `$REPO`. If `.claude/YALLA.md` sets `repo` explicitly, that wins.
- Sanity-check issue access (replace `$REPO`):
  ```bash
  gh issue list --repo "$REPO" --limit 1 >/dev/null
  ```
- Task IDs are `issue-###`, where `###` is the GitHub issue number. `gh issue create` / `gh issue view` / `gh pr create` work normally.

**If `gh` is NOT authenticated** (or unavailable) and `tracking_mode` is `github`:

- Halt and inform the user:
  ```
  GitHub CLI not authenticated. GitHub tracking is configured, so Yalla cannot create or resume the canonical issue.

  To continue with GitHub tracking, run `gh auth login`.
  To intentionally run without GitHub, set `tracking_mode: file-only` in .claude/YALLA.md and re-run.
  ```
- Do not create a local issue ID or plan file in this mode.

### Linear mode

When `tracking_mode` is `linear`, read `task_system` from `.claude/YALLA.md` and verify:

- `provider: linear`
- `ready_states` includes every state eligible for queue/report selection
- `in_progress_state`, `review_state`, and `blocked_state` match exact Linear workflow state names
- `team` or `project` narrows queue selection enough to avoid scanning unrelated work

Use the Linear connector, CLI, or API available in the host environment to read the issue. Record the access method in `.pipeline-state.json`. In dry-run/report-only modes, do not mutate Linear.

GitHub is still needed for PR creation. If `gh` is unavailable in Linear mode, continue through plan/report-only work, but do not claim the run can ship a PR until GitHub auth is restored.

**If `tracking_mode` is `file-only`:**

- Inform the user:
  ```
  Running in configured file-only tracking mode.

  Task state: .pipeline-state.json
  Plan:       plans/active/issue-###-slug.md
  Learnings:  docs/learnings/ (if the directory exists)
  ```
- Set `tracking_mode: "file-only"` and `github_available: false`.
- Skip `gh issue create` / `gh pr create` steps.
- Generate task IDs by scanning existing plan files:
  ```bash
  ls plans/active/issue-*.md 2>/dev/null | grep -oE 'issue-[0-9]+' | sort -t- -k2 -n | tail -1
  ```
  If no plans exist, start at `issue-0001`. A local plan file is allowed only when file-only mode was configured explicitly.

## Step 3: Resolve base branch

Read `base_branch` from `.claude/YALLA.md` (default `main`). Store as `$BASE_BRANCH`. Fetch it before cutting work:

```bash
git fetch origin "$BASE_BRANCH"
```

## Success State

Write or update `.pipeline-state.json` with:

```json
{
  "tracking_mode": "github|linear|file-only|db",
  "github_available": true,
  "tracker_available": true,
  "base_branch": "main",
  "phase": "0-classify"
}
```

## Base Health Check

Before creating multiple branches or PRs, check whether the base branch is already red.

- If a shared blocker is already fixed by another PR, wait for it to land or rebase after it lands.
- If several parallel PRs would inherit the same red base, fix the shared blocker first.
- If the failing check is unrelated and already has an owner, document it in the PR body instead of bloating the diff.

---

## DB mode (advanced, optional)

Only relevant if `.claude/YALLA.md` sets `tracking_mode: db`. Most users can ignore this — GitHub-Issues mode and file-only mode need no database.

DB mode backs task state with a SQL `tasks` table (and optionally an append-only memory table). Schema and queries live in `knowledge/yalla/SQL-TEMPLATES.md`.

**Connectivity check:** confirm a database client is available in the session and that the `tasks` table exists, e.g.:

```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = 'tasks'
) AS has_tasks;
```

- **If reachable and `has_tasks = true`:** keep `tracking_mode: "db"`. The SQL templates apply.
- **If unreachable or the table is missing:** warn the user and degrade to `github` (if `gh` is available) or `file-only`. Do not block the run on the database.

GitHub issues/PRs still work alongside DB mode when `gh` is authenticated.
