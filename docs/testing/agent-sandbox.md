# Agent Sandbox Verification

Use the agent sandbox harness when a Yalla or coding-agent run needs to prove
its current dirty working tree in an isolated workspace before review.

```bash
npm run agent:sandbox -- doctor --provider local
npm run agent:sandbox -- doctor --provider crabbox
npm run agent:sandbox -- verify --profile auto --issue issue-1234
```

The default provider is `crabbox`, with `hetzner` as the first configured
underlying Crabbox provider. The `local` provider remains available for offline
harness checks: it copies the current working tree into a clean temp directory,
excludes secrets/heavy artifacts from `agent-sandbox.config.json`, runs the
selected profile commands, collects logs under
`.pipeline/agent-sandbox-artifacts/`, writes
`.pipeline/agent-sandbox-proof.json`, and tears the temp directory down.

## Profiles

| Profile | Use when | Proof boundary |
|---|---|---|
| `fast` | docs, tests, pure code, low-risk refactors | typecheck/tests/evals in a clean copy |
| `ui-smoke` | UI/routes/browser behavior | isolated workspace plus app/browser commands when configured |
| `mcp` | MCP endpoints/tools/docs | MCP contract and inventory commands |
| `schema` | migrations, RLS, tenant schema, SQL | must eventually use an isolated DB; shared staging is supporting evidence only |
| `money` | checkout, pricing, entitlements | must eventually use isolated app/test fixtures |
| `delivery` | repo generation, jobs, artifact publishing | must eventually use isolated app and DB |

`auto` chooses the strictest profile from changed files. Higher-risk profiles
intentionally become `NOT_PROVEN` when their required isolation is missing.

## Crabbox Remote Canary

Manual GitHub Actions canary:

```bash
gh workflow run agent-sandbox-contract.yml --ref main \
  -f crabbox_provider=hetzner \
  -f profile=fast
```

Required GitHub secrets for the workflow, using a Crabbox coordinator:

- `CRABBOX_COORDINATOR_URL`
- `CRABBOX_COORDINATOR_TOKEN`

For direct Hetzner canaries instead of a coordinator, set either:

- `HCLOUD_TOKEN`
- `HETZNER_TOKEN`

The workflow installs Crabbox, authenticates with `crabbox login --token-stdin`
when coordinator secrets are present or uses the direct provider token when not,
runs local and Crabbox doctors, then runs one remote proof. It is
`workflow_dispatch` only and is not a required PR check.

## Local Supabase In Sandboxes

Crabbox runs `npm ci` before profile commands because `node_modules` is never
synced. Profiles that require DB isolation (`schema`, `money`, `delivery`) then
run `scripts/agent-sandbox/setup-local-supabase.sh` before profile commands on
the Crabbox box. The helper installs Docker on apt-based Linux sandboxes when it
is missing, initializes `supabase/config.toml` only inside the synced sandbox
copy when missing, runs `supabase start`, and maps the generated local Supabase
env into `.pipeline/local-supabase-mapped.env`.

This is intentionally separate from live `.env.local` and project secrets.
