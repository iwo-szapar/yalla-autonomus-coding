import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const roleSchema = z.object({
  id: z.enum(['product', 'project', 'engineering', 'testing']),
  vote: z.enum(['approve', 'amend', 'reject']),
  confidence: z.number().min(0).max(1),
  findings: z.array(z.string()),
  required_changes: z.array(z.string()),
  blocked_on: z.array(z.string()),
})

const requirementCourtSchema = z.object({
  version: z.literal(1),
  issue_id: z.string().regex(/^issue-[0-9]+$/),
  session_id: z.string().min(1),
  mode: z.enum(['independent-review', 'single-agent-structured', 'static-advisor']),
  trigger: z.enum(['non_tiny', 'ambiguous', 'autopilot', 'high_risk', 'cross_domain', 'manual']),
  created_at: z.string().min(1),
  raw_request_summary: z.string(),
  goal_contract_ref: z.literal('.pipeline/goal-contract.json'),
  roles: z.array(roleSchema).min(4),
  decision_rule: z.object({
    required_approvals: z.number().int().min(1),
    reject_blocks: z.boolean(),
    human_final_approval_required: z.boolean(),
  }),
  judge: z.object({
    decision: z.enum(['approved', 'approved_with_amendments', 'blocked', 'rejected']),
    summary: z.string(),
    accepted_scope: z.array(z.string()),
    excluded_scope: z.array(z.string()),
    required_amendments: z.array(z.string()),
    risk_notes: z.array(z.string()),
  }),
  human_confirmation: z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'amended', 'not_required']),
    confirmed_by: z.string().nullable(),
    confirmed_at: z.string().nullable(),
    notes: z.string(),
  }),
})

const fileSchema = z.object({
  path: z.string().min(1),
  pre_sha256: z.string().nullable(),
  post_sha256: z.string().nullable(),
  state: z.enum(['modified', 'added', 'deleted', 'moved', 'metadata_only']),
})

const changeSnapshotSchema = z.object({
  version: z.literal(1),
  snapshot_id: z.string().regex(/^snap-[A-Za-z0-9._-]+$/),
  session_id: z.string().min(1),
  issue_id: z.string().regex(/^issue-[0-9]+$/),
  phase: z.enum(['before_mutation', 'after_mutation', 'verification', 'rollback_plan', 'exception']),
  risk_gate: z.enum(['database', 'payment', 'auth', 'email', 'ai', 'generated_artifact', 'bulk_edit', 'pipeline_config', 'security', 'dependency', 'other']),
  action: z.enum(['edit', 'generate', 'delete', 'move', 'format', 'dependency_change', 'metadata_only']),
  purpose: z.string(),
  reason: z.string(),
  files: z.array(fileSchema),
  expected_behavior: z.array(z.string()),
  verification_plan: z.array(z.string()),
  verification_result: z.object({
    status: z.enum(['pending', 'passed', 'failed', 'skipped']),
    commands: z.array(z.string()),
    notes: z.string(),
  }),
  rollback_plan: z.object({
    safe_to_auto_apply: z.boolean(),
    instructions: z.array(z.string()),
    requires_human: z.boolean(),
  }),
  redactions: z.array(z.string()),
  created_at: z.string().min(1),
})

function readJson(path: string) {
  return JSON.parse(readFileSync(join(repoRoot, path), 'utf8'))
}

describe('Yalla run-control contracts', () => {
  it('ships requirement court and change snapshot protocols with schemas and examples', () => {
    for (const path of [
      'knowledge/yalla/REQUIREMENT-COURT.md',
      'knowledge/yalla/CHANGE-SNAPSHOTS.md',
      'knowledge/yalla/schemas/requirement-court.schema.json',
      'knowledge/yalla/schemas/change-snapshot.schema.json',
      'knowledge/yalla/examples/requirement-court.example.json',
      'knowledge/yalla/examples/change-snapshot.example.jsonl',
    ]) {
      expect(existsSync(join(repoRoot, path)), path).toBe(true)
    }
  })

  it('keeps JSON schemas parseable and draft-07 compatible', () => {
    const courtSchema = readJson('knowledge/yalla/schemas/requirement-court.schema.json')
    const snapshotSchema = readJson('knowledge/yalla/schemas/change-snapshot.schema.json')

    expect(courtSchema.$schema).toBe('http://json-schema.org/draft-07/schema#')
    expect(courtSchema.definitions.role.required).toContain('vote')
    expect(snapshotSchema.$schema).toBe('http://json-schema.org/draft-07/schema#')
    expect(snapshotSchema.definitions.file.required).toEqual(['path', 'pre_sha256', 'post_sha256', 'state'])
  })

  it('keeps requirement court and change snapshot examples aligned with their contracts', () => {
    requirementCourtSchema.parse(readJson('knowledge/yalla/examples/requirement-court.example.json'))

    const entries = readFileSync(join(repoRoot, 'knowledge/yalla/examples/change-snapshot.example.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as unknown)

    expect(entries).toHaveLength(2)
    for (const entry of entries) changeSnapshotSchema.parse(entry)
  })

  it('vendors nested protocol schemas and examples through install.sh', () => {
    const target = mkdtempSync(join(tmpdir(), 'yalla-run-control-install-'))

    execFileSync(join(repoRoot, 'install.sh'), [target], { cwd: repoRoot, stdio: 'pipe' })

    expect(existsSync(join(target, '.claude/knowledge/yalla/REQUIREMENT-COURT.md'))).toBe(true)
    expect(existsSync(join(target, '.claude/knowledge/yalla/CHANGE-SNAPSHOTS.md'))).toBe(true)
    expect(existsSync(join(target, '.claude/knowledge/yalla/schemas/requirement-court.schema.json'))).toBe(true)
    expect(existsSync(join(target, '.claude/knowledge/yalla/examples/change-snapshot.example.jsonl'))).toBe(true)

    const vendoredCourt = readFileSync(join(target, '.claude/knowledge/yalla/REQUIREMENT-COURT.md'), 'utf8')
    expect(vendoredCourt).not.toContain('${CLAUDE_PLUGIN_ROOT}')
    expect(vendoredCourt).toContain('.claude/knowledge/yalla/schemas/requirement-court.schema.json')
  })
})
