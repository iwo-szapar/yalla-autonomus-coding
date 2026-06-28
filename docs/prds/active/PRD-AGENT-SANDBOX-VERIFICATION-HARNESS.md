# PRD: Agent Sandbox Verification Harness

**Status:** Active rollout
**Canonical repo:** `iwo-szapar/yalla-autonomus-coding`
**Moved from:** accidental SBF implementation/issue placement on 2026-06-28

## Intent

Every non-trivial autonomous-coding PR should carry trustworthy proof from an
isolated environment. Review should focus on product and code judgment, not on
whether the agent actually ran the app, tests, or database path it claims.

## Core Claims

- A sandbox proof means the current dirty diff ran in a clean, isolated
  workspace.
- A sandbox proof does not mean production is safe to release.
- Schema, money, delivery, and browser-sensitive work need stronger isolation
  than local unit tests or shared staging state.

## Providers

The harness is provider-agnostic in shape and ships with:

- `local`: clean temp-copy adapter for cheap unit/eval proof.
- `crabbox`: first remote adapter path, configured with Hetzner as the initial
  underlying provider.

Future providers should satisfy the same contract instead of entering Yalla
logic directly.

## Profiles

| Profile | Trigger | Required proof boundary |
|---|---|---|
| `fast` | docs, tests, low-risk code | clean workspace commands |
| `ui-smoke` | browser/UI/frontend changes | sandbox-owned app/browser evidence |
| `mcp` | MCP endpoints/tools/docs | isolated command + inventory proof |
| `schema` | migrations, SQL, RLS, Supabase | isolated DB proof |
| `money` | checkout, pricing, entitlements | isolated app/test fixtures and DB when required |
| `delivery` | repo generation, jobs, artifacts | isolated app/DB and delivery artifacts |

`auto` routes to the strictest matching profile.

## Proof Manifest

The harness writes `.pipeline/agent-sandbox-proof.json` with:

- issue id, profile, provider, sandbox id;
- base SHA, dirty diff hash, changed files;
- isolation claims for workspace, app server, DB, and network;
- commands with exit code, duration, and stdout/stderr artifact refs;
- artifact refs with hashes;
- redaction status and patterns checked;
- teardown status;
- verdict: `PROVEN`, `NOT_PROVEN`, or `INCONCLUSIVE`.

`INCONCLUSIVE` is a useful record, not success.

## Rollout Issues

- #29 Configure Hetzner credentials and run first remote canary
- #30 Extract provider interface and add remote provider contract tests
- #31 Prove isolated local Supabase DB for remote schema profiles
- #32 Capture UI smoke screenshots and traces in sandbox proof artifacts
- #33 Enforce sandbox proof in Yalla verification and PR evidence
- #34 Harden sandbox env allowlists and artifact redaction
- #35 Promote local sandbox proof checks into CI
- #36 Add cost controls, teardown audit, and five-green remote rollout gate
- #37 Validate MCP profile in a remote sandbox
- #38 Add isolated money profile proof for checkout and Stripe test fixtures
- #39 Add isolated delivery profile proof for repo generation and artifact publishing
- #40 Decide storage policy for large sandbox artifacts
- #41 Agent sandbox rollout tracker

## Acceptance

- `npm run agent:sandbox -- doctor --provider local` passes.
- `npm run eval:yalla:sandbox-proof` passes and is included in smoke.
- High-risk `PROVEN` proof is rejected without remote sandbox and required DB
  isolation.
- Manual Crabbox canary exists and fails clearly when provider credentials are
  missing.
- Yalla enforcement cannot mark high-risk work `PROVEN` without valid sandbox
  proof or explicit accepted-risk downgrade to `INCONCLUSIVE`.
