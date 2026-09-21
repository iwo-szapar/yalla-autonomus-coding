import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runYallaRun } from '../../scripts/yalla-run.js'

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'yalla-run-'))
}

function writeConfig(root: string, extra = '') {
  mkdirSync(join(root, '.claude'), { recursive: true })
  mkdirSync(join(root, 'tests'))
  writeFileSync(
    join(root, '.claude/YALLA.md'),
    `repo: "owner/repo"
base_branch: main
tracking_mode: github
test_dir: tests/
commands:
  test: "npm test"
  typecheck: "npm run typecheck"
models:
  classify: "cheap"
  implement: "sonnet"
  review: "opus"
verifiers:
  api: "npm test"
  visual: ".pipeline/visual-evidence/"
${extra}autopilot:
  max_iterations: 2
  max_runtime_minutes: 30
`
  )
}

function gitTempRoot(extra = '') {
  const root = tempRoot()
  writeConfig(root, extra)
  writeFileSync(join(root, 'app.ts'), 'export const value = 1\n')
  execFileSync('git', ['init', '-b', 'main'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Yalla Test'], { cwd: root })
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/owner/repo.git'], { cwd: root })
  execFileSync('git', ['add', '.claude/YALLA.md', 'app.ts'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: root })
  return root
}

function writeReleaseAdapter(root: string, overrides: Record<string, unknown> = {}) {
  writeFileSync(join(root, '.claude/release-adapter.json'), JSON.stringify({
    schema_version: 1,
    tier: 'T1',
    project_identity: { repository: 'owner/repo', project_id: 'project-id', target: 'candidate' },
    dependencies: [],
    commands: { preflight: 'npm run preflight', focused_checks: ['npm run focused'], full_checks: ['npm test'], smoke_assertions: ['marker exists'] },
    protected_capabilities: [],
    budgets: { max_remote_jobs_per_candidate: 2, max_full_suites_per_candidate: 1, max_production_builds_per_candidate: 1 },
    ...overrides,
  }))
}

const nAGateRequirements = {
  surface_parity: { status: 'n/a', reason: 'No equivalent product surfaces change.' },
  trust_map: { status: 'n/a', reason: 'No trust boundary changes.' },
  volume_envelope: { status: 'n/a', reason: 'No remote collection or call fan-out.' },
  lifecycle_states: { status: 'n/a', reason: 'No external lifecycle states are consumed.' },
  ui_proof: { status: 'n/a', reason: 'No user interface changes.' },
}

const nAEvidenceGates = {
  external_grounding: { applies: false, reason: 'No external behavior dependency.' },
  runtime_e2e_preflight: { applies: false, reason: 'No runtime environment claim.' },
  surface_parity: { applies: false, reason: 'No equivalent product surfaces change.' },
  trust_map: { applies: false, reason: 'No trust boundary changes.' },
  volume_envelope: { applies: false, reason: 'No remote collection or call fan-out.' },
  lifecycle_states: { applies: false, reason: 'No external lifecycle states are consumed.' },
  ui_proof: { applies: false, reason: 'No user interface changes.' },
}

async function writeAndStampClassification(root: string, issueId = 'issue-47', requiredGates = ['candidate-integrity-check']) {
  writeFileSync(join(root, '.pipeline/classification.json'), JSON.stringify({
    issue_id: issueId,
    required_gates: requiredGates,
    external_grounding_gate: 'n/a',
    external_grounding_gate_reason: 'No external behavior dependency.',
    runtime_e2e_gate: 'n/a',
    runtime_e2e_gate_reason: 'No runtime environment claim.',
    evidence_gate_requirements: nAGateRequirements,
  }))
  return runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/classification.json' })
}

describe('scripts/yalla-run.ts', () => {
  it('appends structured events to .pipeline/events.jsonl', async () => {
    const root = tempRoot()
    writeConfig(root)
    const result = await runYallaRun({ command: 'event', rootDir: root, event: 'stage.started', phase: 'plan', message: 'Planning started', now: () => '2026-06-14T10:00:00.000Z' })

    expect(result.exitCode).toBe(0)
    expect(result.eventPath).toBe(join(root, '.pipeline/events.jsonl'))
    const lines = readFileSync(result.eventPath ?? '', 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({ ts: '2026-06-14T10:00:00.000Z', event: 'stage.started', phase: 'plan', properties: { message: 'Planning started' } })
  })

  it('writes phase checkpoints and exposes status', async () => {
    const root = tempRoot()
    writeConfig(root)
    const checkpoint = await runYallaRun({ command: 'checkpoint', rootDir: root, phase: 'test', message: 'Tests passed', now: () => '2026-06-14T10:00:00.000Z' })
    const status = await runYallaRun({ command: 'status', rootDir: root })

    expect(checkpoint.exitCode).toBe(0)
    expect(existsSync(checkpoint.checkpointPath ?? '')).toBe(true)
    expect(status.status).toMatchObject({ phase: 'test', verdict: 'UNKNOWN', next_action: 'Continue to review.' })
    expect(status.status?.completed_phases).toEqual(['classify', 'track', 'plan', 'work', 'test'])
  })

  it('generates a local HTML run report', async () => {
    const root = gitTempRoot()
    mkdirSync(join(root, '.pipeline/visual-evidence'), { recursive: true })
    writeFileSync(join(root, '.pipeline/visual-evidence/after.svg'), '<svg></svg>')
    writeFileSync(join(root, '.pipeline/benchmarks.json'), JSON.stringify({ p95_ms: 120 }))
    await runYallaRun({ command: 'event', rootDir: root, event: 'review.completed', phase: 'review', message: 'Review passed' })
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Ship a verified healthcheck', criteria: ['returns ok'], evidence: ['npm test'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    await runYallaRun({ command: 'evaluate', rootDir: root, evaluator: 'reviewer', verdict: 'PASS', message: 'Evidence is sufficient' })
    const result = await runYallaRun({ command: 'report', rootDir: root })

    expect(result.reportPath).toBe(join(root, '.pipeline/report.html'))
    const html = readFileSync(result.reportPath ?? '', 'utf8')
    expect(html).toContain('Yalla Run Report')
    expect(html).toContain('Pipeline Graph')
    expect(html).toContain('Goal Contract')
    expect(html).toContain('Evaluator Results')
    expect(html).toContain('Visual Evidence')
    expect(html).toContain('after.svg')
    expect(html).toContain('Benchmarks')
    expect(html).toContain('review.completed')
    expect(html).toContain('Review passed')
  })

  it('exports a portable run bundle with status telemetry', async () => {
    const root = tempRoot()
    writeConfig(root)
    await runYallaRun({ command: 'event', rootDir: root, event: 'stage.started', phase: 'plan', message: 'start', now: () => '2026-06-14T10:00:00.000Z' })
    await runYallaRun({ command: 'event', rootDir: root, event: 'stage.completed', phase: 'plan', message: 'done', now: () => '2026-06-14T10:01:05.000Z' })
    const result = await runYallaRun({ command: 'export', rootDir: root })

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(result.exportPath ?? '', 'events.jsonl'))).toBe(true)
    expect(result.status?.exported_artifacts).toEqual(expect.arrayContaining(['events.jsonl', 'status.json']))
    const status = JSON.parse(readFileSync(join(result.exportPath ?? '', 'status.json'), 'utf8'))
    expect(status.telemetry.duration_seconds).toBe(65)
    expect(status.telemetry.phase_event_counts.plan).toBe(2)
  })

  it('doctor validates repo, config, commands, model routes, and gh', async () => {
    const root = tempRoot()
    writeConfig(root)
    const result = await runYallaRun({
      command: 'doctor',
      rootDir: root,
      commandRunner: async (command) => {
        if (command === 'git') return { stdout: 'true', stderr: '', exitCode: 0 }
        return { stdout: 'logged in', stderr: '', exitCode: 0 }
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'model_routing', status: 'pass' }), expect.objectContaining({ name: 'verifier_registry', status: 'pass' }), expect.objectContaining({ name: 'github_auth', status: 'pass' })]))
  })

  it('doctor fails unknown verifier route keys', async () => {
    const root = tempRoot()
    writeConfig(root, '  mystery: "custom verifier"\n')
    const result = await runYallaRun({
      command: 'doctor',
      rootDir: root,
      commandRunner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    })

    expect(result.exitCode).toBe(1)
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'verifier_registry', status: 'fail', detail: expect.stringContaining('mystery') })]))
  })

  it('doctor rejects persistent protected capabilities and adapter repository mismatch', async () => {
    const root = tempRoot()
    writeConfig(root, 'release_adapter: ".claude/release-adapter.json"\ncapabilities:\n  allowed: [read_repo, merge_pr]\n')
    writeFileSync(join(root, '.claude/release-adapter.json'), JSON.stringify({
      schema_version: 1,
      tier: 'T1',
      project_identity: { repository: 'other/repo', project_id: 'project-id', target: 'candidate' },
      dependencies: [],
      commands: { preflight: 'npm run preflight', focused_checks: ['npm run focused'], full_checks: ['npm test'], smoke_assertions: ['marker exists'] },
      protected_capabilities: [],
      budgets: { max_remote_jobs_per_candidate: 2, max_full_suites_per_candidate: 1, max_production_builds_per_candidate: 1 },
    }))
    const result = await runYallaRun({
      command: 'doctor',
      rootDir: root,
      commandRunner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    })

    expect(result.exitCode).toBe(1)
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'protected_capability_defaults', status: 'fail' }),
      expect.objectContaining({ name: 'release_adapter_identity', status: 'fail' }),
    ]))
  })

  it('writes goal contracts, evaluator results, and loop state', async () => {
    const root = gitTempRoot()
    const goal = await runYallaRun({ command: 'goal', rootDir: root, message: 'Deliver a tested feature', criteria: ['test passes'], constraint: ['no API drift'], evidence: ['npm test'], forbiddenShortcut: ['model-only proof'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    const evaluation = await runYallaRun({ command: 'evaluate', rootDir: root, evaluator: 'test-reviewer', verdict: 'FAIL', failureClass: 'CANDIDATE_FAILURE', finding: ['missing negative path'], message: 'Add a negative test' })
    const loop = await runYallaRun({ command: 'loop', rootDir: root })

    expect(goal.goalPath).toBe(join(root, '.pipeline/goal-contract.json'))
    expect(evaluation.exitCode).toBe(1)
    expect(evaluation.evaluatorPath).toBe(join(root, '.pipeline/evaluator-results.json'))
    expect(loop.loopPath).toBe(join(root, '.pipeline/loop-state.json'))
    expect(loop.status).toMatchObject({ decision: 'continue', next_instruction: 'Add a negative test' })
  })

  it('rejects FAIL evaluator results without a valid failure class', async () => {
    const root = gitTempRoot()
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Require typed failures', criteria: ['typed'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    expect((await runYallaRun({ command: 'evaluate', rootDir: root, verdict: 'FAIL' })).instruction).toContain('valid --failure-class')
    expect((await runYallaRun({ command: 'evaluate', rootDir: root, verdict: 'FAIL', failureClass: 'typo' })).instruction).toContain('valid --failure-class')
  })

  it('does not accept legacy unbound proof as current', async () => {
    const root = tempRoot()
    writeConfig(root)
    mkdirSync(join(root, '.pipeline'), { recursive: true })
    writeFileSync(join(root, '.pipeline/outcome-evaluation.json'), JSON.stringify({ verdict: 'PROVEN' }))

    const status = await runYallaRun({ command: 'status', rootDir: root })
    const evaluation = await runYallaRun({ command: 'evaluate', rootDir: root, evaluator: 'reviewer', verdict: 'PASS' })
    const loop = await runYallaRun({ command: 'loop', rootDir: root })

    expect(status.status).toMatchObject({ candidate_state: 'UNBOUND', verdict: 'UNKNOWN' })
    expect(evaluation).toMatchObject({ exitCode: 1, instruction: expect.stringContaining('No active candidate') })
    expect(loop.status).toMatchObject({ decision: 'stop-identity' })
  })

  it('mines sessions for durable update suggestions', async () => {
    const root = tempRoot()
    writeConfig(root)
    mkdirSync(join(root, '.pipeline'), { recursive: true })
    writeFileSync(join(root, '.pipeline/test-evidence.json'), JSON.stringify({ commands: [{ command: 'npm test', status: 'fail' }] }))
    writeFileSync(join(root, '.pipeline/review-results.json'), JSON.stringify({ checks: [{ name: 'coverage', verdict: 'FAIL' }] }))
    await runYallaRun({ command: 'event', rootDir: root, event: 'run.inconclusive', phase: 'test', message: 'blocked by missing fixture' })
    const result = await runYallaRun({ command: 'mine-sessions', rootDir: root })

    expect(result.miningPath).toBe(join(root, '.pipeline/session-mining-report.json'))
    expect(result.status?.suggested_updates).toEqual(expect.arrayContaining([expect.objectContaining({ target: '.claude/YALLA.md gotchas' }), expect.objectContaining({ target: 'knowledge/yalla/PROJECT-CHECKS.md' }), expect.objectContaining({ target: 'eval/yalla/data' })]))
  })

  it('resume and rewind return non-destructive instructions', async () => {
    const root = tempRoot()
    writeConfig(root)
    await runYallaRun({ command: 'checkpoint', rootDir: root, phase: 'plan' })
    await runYallaRun({ command: 'checkpoint', rootDir: root, phase: 'work' })

    const resume = await runYallaRun({ command: 'resume', rootDir: root })
    const rewind = await runYallaRun({ command: 'rewind', rootDir: root, target: 'plan' })

    expect(resume.exitCode).toBe(1)
    expect(resume.instruction).toContain('RESUMABLE_AFTER_REVALIDATION')
    expect(rewind.exitCode).toBe(0)
    expect(rewind.instruction).toContain('does not run destructive git commands')
    expect(rewind.checkpointPath).toContain('plan')
  })

  it('resumes only the exact candidate and stops after working-tree drift', async () => {
    const root = gitTempRoot()
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Prove exact resume', criteria: ['same candidate'] })
    const created = await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47', runId: 'run-47' })
    await runYallaRun({ command: 'checkpoint', rootDir: root, phase: 'plan' })

    expect(created.exitCode).toBe(0)
    expect((await runYallaRun({ command: 'resume', rootDir: root }))).toMatchObject({ exitCode: 0, instruction: expect.stringContaining('RESUMABLE_EXACT') })

    writeFileSync(join(root, 'app.ts'), 'export const value = 2\n')
    const drifted = await runYallaRun({ command: 'resume', rootDir: root })
    expect(drifted.exitCode).toBe(1)
    expect(drifted.instruction).toContain('RESUMABLE_AFTER_REVALIDATION')
  })

  it('routes typed evaluator failures into distinct loop decisions', async () => {
    const cases = [
      ['CANDIDATE_FAILURE', 'continue'],
      ['BASELINE_FAILURE', 'stop-baseline'],
      ['INFRA_ERROR', 'retry-infra'],
      ['IDENTITY_MISMATCH', 'stop-identity'],
      ['POLICY_BLOCKED', 'stop-policy'],
      ['SUPERSEDED', 'stop-superseded'],
    ] as const

    for (const [failureClass, decision] of cases) {
      const root = gitTempRoot()
      await runYallaRun({ command: 'goal', rootDir: root, message: 'Route failures', criteria: ['typed failure'] })
      await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
      await runYallaRun({ command: 'evaluate', rootDir: root, evaluator: 'reviewer', verdict: 'FAIL', failureClass, finding: ['failure'] })
      const loop = await runYallaRun({ command: 'loop', rootDir: root })
      expect(loop.status?.decision).toBe(decision)
    }
  })

  it('ignores a late evaluator result after a new candidate is minted', async () => {
    const root = gitTempRoot()
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Ignore stale review', criteria: ['exact candidate only'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47', runId: 'run-47' })
    await runYallaRun({ command: 'evaluate', rootDir: root, evaluator: 'late-reviewer', verdict: 'FAIL', failureClass: 'POLICY_BLOCKED', finding: ['old head'] })
    writeFileSync(join(root, 'app.ts'), 'export const value = 2\n')
    execFileSync('git', ['add', 'app.ts'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'new candidate'], { cwd: root })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47', runId: 'run-47' })

    const loop = await runYallaRun({ command: 'loop', rootDir: root })
    expect(loop.status).toMatchObject({ decision: 'continue', evaluator_verdict: null })
  })

  it('writes a candidate-bound baseline and idempotent operation/build receipts', async () => {
    const root = gitTempRoot('release_adapter: ".claude/release-adapter.json"\ncapabilities:\n  allowed: [read_repo, write_worktree, open_pr]\n')
    writeReleaseAdapter(root)
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Record controlled operations', criteria: ['receipts'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    const baseline = await runYallaRun({ command: 'baseline', rootDir: root, finding: ['known red check'] })
    const operation = await runYallaRun({ command: 'operation', rootDir: root, operationId: 'open-47', capability: 'open_pr', action: 'open', target: 'issue-47' })
    const duplicate = await runYallaRun({ command: 'operation', rootDir: root, operationId: 'open-47', capability: 'open_pr', action: 'open', target: 'issue-47' })
    const remote = await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'build-47', jobKind: 'full-suite', jobStatus: 'reserve', artifactAction: 'built' })
    const completedRemote = await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'build-47', jobKind: 'full-suite', jobStatus: 'succeeded', artifactAction: 'built', durationSeconds: 90, cost: 0.5 })

    expect(baseline.exitCode).toBe(0)
    expect(operation.status?.status).toBe('recorded')
    expect(duplicate.status?.status).toBe('duplicate')
    expect(remote.status?.status).toBe('recorded')
    expect(completedRemote.status?.status).toBe('updated')
  })

  it('refuses to authorize protected capabilities in the local runner', async () => {
    const root = gitTempRoot('release_adapter: ".claude/release-adapter.json"\n')
    writeReleaseAdapter(root, { protected_capabilities: ['merge_pr'] })
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Protect production actions', criteria: ['approval receipt'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47', runId: 'protected-op' })

    const denied = await runYallaRun({ command: 'operation', rootDir: root, operationId: 'merge-47', capability: 'merge_pr', action: 'merge', target: 'pr-47' })
    expect(denied).toMatchObject({ exitCode: 1, instruction: expect.stringContaining('cannot be authorized by the local Yalla runner') })
    expect(existsSync(join(root, '.pipeline/operation-receipts.json'))).toBe(false)
  })

  it('can close an externally reserved protected receipt after candidate drift', async () => {
    const root = gitTempRoot()
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Close external receipt', criteria: ['terminal telemetry'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    const candidate = JSON.parse(readFileSync(join(root, '.pipeline/candidate.json'), 'utf8'))
    writeFileSync(join(root, '.pipeline/operation-receipts.json'), JSON.stringify({
      schema_version: 1,
      receipts: [{
        operation_id: 'merge-external-47', capability: 'merge_pr', action: 'merge', target: 'pr-47', status: 'pending',
        candidate_id: candidate.candidate_id, candidate_sha: candidate.head_sha, approval_reference: 'external://approval/47',
        execution_authority: 'none-local-telemetry-only', recorded_at: '2026-09-20T12:00:00.000Z',
      }],
    }))
    writeFileSync(join(root, 'app.ts'), 'export const value = 2\n')

    const completed = await runYallaRun({ command: 'operation', rootDir: root, operationId: 'merge-external-47', capability: 'merge_pr', action: 'merge', target: 'pr-47', operationStatus: 'succeeded' })
    expect(completed.status?.status).toBe('updated')
    expect((completed.status?.receipt as Record<string, unknown>)?.status).toBe('succeeded')
    expect((completed.status?.receipt as Record<string, unknown>)?.execution_authority).toBe('none-local-telemetry-only')
  })

  it('cannot close a protected receipt without the telemetry-only authority marker', async () => {
    const root = gitTempRoot()
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Reject ambiguous protected telemetry', criteria: ['authority marker required'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    const candidate = JSON.parse(readFileSync(join(root, '.pipeline/candidate.json'), 'utf8'))
    writeFileSync(join(root, '.pipeline/operation-receipts.json'), JSON.stringify({ receipts: [{
      operation_id: 'merge-ambiguous-47', capability: 'merge_pr', action: 'merge', target: 'pr-47', status: 'pending',
      candidate_id: candidate.candidate_id, candidate_sha: candidate.head_sha, recorded_at: '2026-09-20T12:00:00.000Z',
    }] }))

    const denied = await runYallaRun({ command: 'operation', rootDir: root, operationId: 'merge-ambiguous-47', capability: 'merge_pr', action: 'merge', target: 'pr-47', operationStatus: 'succeeded' })
    expect(denied).toMatchObject({ exitCode: 1, instruction: expect.stringContaining('expected execution_authority none-local-telemetry-only') })
  })

  it('rejects invalid operation status instead of silently reserving pending', async () => {
    const root = gitTempRoot('capabilities:\n  allowed: [read_repo, write_worktree, open_pr]\n')
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Reject status typos', criteria: ['invalid status fails'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    const result = await runYallaRun({ command: 'operation', rootDir: root, operationId: 'open-47', capability: 'open_pr', action: 'open', target: 'issue-47', operationStatus: 'sucessed' })
    expect(result).toMatchObject({ exitCode: 1, instruction: expect.stringContaining('Invalid --operation-status sucessed') })
    expect(existsSync(join(root, '.pipeline/operation-receipts.json'))).toBe(false)
  })

  it('refuses repository-supplied preflight execution and self-stamping', async () => {
    const root = gitTempRoot('release_adapter: ".claude/release-adapter.json"\n')
    writeReleaseAdapter(root)
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Execute immutable preflight', criteria: ['identity observed'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    writeFileSync(join(root, '.pipeline/release-preflight.json'), JSON.stringify({ status: 'pass' }))
    expect(await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/release-preflight.json' })).toMatchObject({ exitCode: 1, instruction: expect.stringContaining('external-controller evidence') })
    let executed = false
    const blocked = await runYallaRun({
      command: 'preflight',
      rootDir: root,
      commandRunner: async () => {
        executed = true
        return { stdout: '', stderr: '', exitCode: 0 }
      },
    })
    expect(blocked).toMatchObject({ exitCode: 1, instruction: expect.stringContaining('POLICY_BLOCKED') })
    expect(executed).toBe(false)
  })

  it('counts an outcome only after it is stamped for the exact candidate', async () => {
    const root = gitTempRoot()
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Stamp final proof', criteria: ['outcome is current'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    await runYallaRun({ command: 'baseline', rootDir: root })
    expect((await writeAndStampClassification(root)).exitCode).toBe(0)
    writeFileSync(join(root, '.pipeline/acceptance-trace.json'), JSON.stringify({ issue_id: 'issue-47', criteria: [{ criterion: 'Outcome is current', proof_mode: 'new-test', status: 'covered', evidence: 'tests/scripts/yalla-run.test.ts' }] }))
    expect((await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/acceptance-trace.json' })).exitCode).toBe(0)
    writeFileSync(join(root, '.pipeline/test-evidence.json'), JSON.stringify({ issue_id: 'issue-47', commands: [{ command: 'npm test', status: 'pass', summary: 'passed' }] }))
    expect((await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/test-evidence.json' })).exitCode).toBe(0)
    writeFileSync(join(root, '.pipeline/review-results.json'), JSON.stringify({ issue_id: 'issue-47', required_checks: ['candidate-integrity-check'], checks: [{ name: 'candidate-integrity-check', verdict: 'pass' }], evidence_gates: nAEvidenceGates }))
    expect((await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/review-results.json' })).exitCode).toBe(0)
    writeFileSync(join(root, '.pipeline/outcome-evaluation.json'), JSON.stringify({ issue_id: 'issue-47', verdict: 'PROVEN', criteria_summary: [{ criterion: 'Outcome is current', status: 'covered', evidence: 'tests/scripts/yalla-run.test.ts' }], remaining_delta: [], human_decisions_needed: [] }))

    expect((await runYallaRun({ command: 'status', rootDir: root })).status?.verdict).toBe('UNKNOWN')
    expect((await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/outcome-evaluation.json' })).exitCode).toBe(0)
    expect((await runYallaRun({ command: 'status', rootDir: root })).status?.verdict).toBe('PROVEN')
    writeFileSync(join(root, '.pipeline/test-evidence.json'), JSON.stringify({ issue_id: 'issue-47', commands: [{ command: 'npm test', status: 'pass', summary: 'changed after proof' }] }))
    expect((await runYallaRun({ command: 'status', rootDir: root })).status?.verdict).toBe('UNKNOWN')
  })

  it('rejects bare PROVEN outcomes and suppresses proof after candidate drift', async () => {
    const root = gitTempRoot()
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Reject false proof', criteria: ['evidence exists'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    writeFileSync(join(root, '.pipeline/outcome-evaluation.json'), JSON.stringify({ issue_id: 'issue-47', verdict: 'PROVEN' }))
    const bareStamp = await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/outcome-evaluation.json' })
    expect(bareStamp).toMatchObject({ exitCode: 1, instruction: expect.stringContaining('required inputs are missing') })

    await runYallaRun({ command: 'baseline', rootDir: root })
    expect((await writeAndStampClassification(root)).exitCode).toBe(0)
    writeFileSync(join(root, '.pipeline/acceptance-trace.json'), JSON.stringify({ issue_id: 'issue-47', criteria: [{ criterion: 'Evidence exists', proof_mode: 'new-test', status: 'covered', evidence: 'test' }] }))
    await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/acceptance-trace.json' })
    writeFileSync(join(root, '.pipeline/test-evidence.json'), JSON.stringify({ issue_id: 'issue-47', commands: [{ command: 'npm test', status: 'pass', summary: 'pass' }] }))
    await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/test-evidence.json' })
    writeFileSync(join(root, '.pipeline/review-results.json'), JSON.stringify({ issue_id: 'issue-47', required_checks: ['candidate-integrity-check'], checks: [{ name: 'candidate-integrity-check', verdict: 'pass' }], evidence_gates: nAEvidenceGates }))
    await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/review-results.json' })
    writeFileSync(join(root, '.pipeline/outcome-evaluation.json'), JSON.stringify({ issue_id: 'issue-47', verdict: 'PROVEN', criteria_summary: [{ criterion: 'Evidence exists', status: 'covered', evidence: 'test' }], remaining_delta: [], human_decisions_needed: [] }))
    await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/outcome-evaluation.json' })
    expect((await runYallaRun({ command: 'status', rootDir: root })).status?.verdict).toBe('PROVEN')

    writeFileSync(join(root, 'app.ts'), 'export const value = 99\n')
    const stale = await runYallaRun({ command: 'status', rootDir: root })
    expect(stale.status?.verdict).toBe('UNKNOWN')
    expect(stale.status?.next_action).not.toContain('Open or update the PR')
  })

  it('rejects proof that does not cover the goal contract, required commands, and armed review gates', async () => {
    const root = gitTempRoot()
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Prove the requested outcome', criteria: ['requested behavior works'], evidence: ['npm test'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    await runYallaRun({ command: 'baseline', rootDir: root })
    expect((await writeAndStampClassification(root, 'issue-47', ['security-check'])).exitCode).toBe(0)
    writeFileSync(join(root, '.pipeline/acceptance-trace.json'), JSON.stringify({ issue_id: 'issue-47', criteria: [{ criterion: 'invented unrelated behavior', proof_mode: 'new-test', status: 'covered', evidence: 'test' }] }))
    await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/acceptance-trace.json' })
    writeFileSync(join(root, '.pipeline/test-evidence.json'), JSON.stringify({ issue_id: 'issue-47', commands: [{ command: 'npm run typecheck', status: 'pass', summary: 'pass' }] }))
    await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/test-evidence.json' })
    writeFileSync(join(root, '.pipeline/review-results.json'), JSON.stringify({ issue_id: 'issue-47', required_checks: ['candidate-integrity-check'], checks: [{ name: 'candidate-integrity-check', verdict: 'pass' }], evidence_gates: nAEvidenceGates }))
    await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/review-results.json' })
    writeFileSync(join(root, '.pipeline/outcome-evaluation.json'), JSON.stringify({ issue_id: 'issue-47', verdict: 'PROVEN', criteria_summary: [{ criterion: 'invented unrelated behavior', status: 'covered', evidence: 'test' }], remaining_delta: [], human_decisions_needed: [] }))

    const result = await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/outcome-evaluation.json' })
    expect(result).toMatchObject({ exitCode: 1, instruction: expect.stringContaining('exact goal-contract success criteria') })

    writeFileSync(join(root, '.pipeline/acceptance-trace.json'), JSON.stringify({ issue_id: 'issue-47', criteria: [{ criterion: 'requested behavior works', proof_mode: 'new-test', status: 'covered', evidence: 'test' }] }))
    await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/acceptance-trace.json' })
    writeFileSync(join(root, '.pipeline/test-evidence.json'), JSON.stringify({ issue_id: 'issue-47', commands: [{ command: 'npm run typecheck', status: 'pass', summary: 'pass' }] }))
    await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/test-evidence.json' })
    writeFileSync(join(root, '.pipeline/review-results.json'), JSON.stringify({ issue_id: 'issue-47', required_checks: ['candidate-integrity-check'], checks: [{ name: 'candidate-integrity-check', verdict: 'pass' }], evidence_gates: nAEvidenceGates }))
    await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/review-results.json' })
    writeFileSync(join(root, '.pipeline/outcome-evaluation.json'), JSON.stringify({ issue_id: 'issue-47', verdict: 'PROVEN', criteria_summary: [{ criterion: 'requested behavior works', status: 'covered', evidence: 'test' }], remaining_delta: [], human_decisions_needed: [] }))
    expect(await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/outcome-evaluation.json' })).toMatchObject({ exitCode: 1, instruction: expect.stringContaining('required evidence command') })

    writeFileSync(join(root, '.pipeline/test-evidence.json'), JSON.stringify({ issue_id: 'issue-47', commands: [{ command: 'npm test', status: 'pass', summary: 'pass' }] }))
    await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/test-evidence.json' })
    writeFileSync(join(root, '.pipeline/review-results.json'), JSON.stringify({ issue_id: 'issue-47', required_checks: ['candidate-integrity-check'], checks: [{ name: 'candidate-integrity-check', verdict: 'pass' }], evidence_gates: nAEvidenceGates }))
    await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/review-results.json' })
    expect(await runYallaRun({ command: 'stamp', rootDir: root, target: '.pipeline/outcome-evaluation.json' })).toMatchObject({ exitCode: 1, instruction: expect.stringContaining('retain every classification required_gate') })
  })

  it('rejects negative remote-job duration and cost', async () => {
    const root = gitTempRoot('release_adapter: ".claude/release-adapter.json"\n')
    writeReleaseAdapter(root)
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Measure remote jobs', criteria: ['valid telemetry'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    expect((await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'bad-duration', jobKind: 'full-suite', jobStatus: 'succeeded', artifactAction: 'built', durationSeconds: -1 })).exitCode).toBe(1)
    expect((await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'bad-cost', jobKind: 'full-suite', jobStatus: 'succeeded', artifactAction: 'built', durationSeconds: 1, cost: -1 })).exitCode).toBe(1)
  })

  it('blocks remote-job reservation when no release adapter defines a budget', async () => {
    const root = gitTempRoot()
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Require remote budget', criteria: ['adapter exists'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    const result = await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'remote-1', jobKind: 'full-suite', jobStatus: 'reserve', artifactAction: 'built' })
    expect(result).toMatchObject({ exitCode: 1, instruction: expect.stringContaining('require a validated release_adapter') })
  })

  it('blocks remote work when the adapter repository identity mismatches', async () => {
    const root = gitTempRoot('release_adapter: ".claude/release-adapter.json"\n')
    writeReleaseAdapter(root, { project_identity: { repository: 'other/repo', project_id: 'project-id', target: 'candidate' } })
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Bind adapter identity', criteria: ['exact adapter'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    const result = await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'remote-1', jobKind: 'full-suite', jobStatus: 'reserve', artifactAction: 'built' })
    expect(result).toMatchObject({ exitCode: 1, instruction: expect.stringContaining('adapter repository other/repo does not match candidate repository owner/repo') })
  })

  it('blocks declared parallel ownership overlap', async () => {
    const root = gitTempRoot()
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Avoid parallel collisions', criteria: ['no path overlap'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    writeFileSync(join(root, '.pipeline/path-ownership.json'), JSON.stringify({ claims: [
      { owner: 'implementer-a', paths: ['src/api'], changed_paths: [] },
      { owner: 'implementer-b', paths: ['src/api/checkout.ts'], changed_paths: [] },
    ] }))

    const result = await runYallaRun({ command: 'ownership', rootDir: root })
    expect(result.exitCode).toBe(1)
    expect(result.status).toMatchObject({ verdict: 'CONFLICT', overlaps: [{ owners: ['implementer-a', 'implementer-b'] }] })
  })

  it('blocks path ownership when actual changed files are outside the claims', async () => {
    const root = gitTempRoot()
    writeFileSync(join(root, 'app.ts'), 'export const value = 2\n')
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Own actual changes', criteria: ['all changes owned'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    writeFileSync(join(root, '.pipeline/path-ownership.json'), JSON.stringify({ claims: [{ owner: 'tester', paths: ['tests'] }] }))

    const result = await runYallaRun({ command: 'ownership', rootDir: root })
    expect(result.exitCode).toBe(1)
    expect(result.status).toMatchObject({ verdict: 'CONFLICT', unowned_changed_paths: ['app.ts'] })
  })

  it('enforces release-adapter remote job budgets per candidate', async () => {
    const root = gitTempRoot('release_adapter: ".claude/release-adapter.json"\n')
    writeReleaseAdapter(root)
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Budget remote work', criteria: ['one full suite'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    expect((await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'full-1', jobKind: 'full-suite', jobStatus: 'reserve', artifactAction: 'built' })).exitCode).toBe(0)
    const blocked = await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'full-2', jobKind: 'full-suite', jobStatus: 'reserve', artifactAction: 'built' })
    expect(blocked.exitCode).toBe(1)
    expect(blocked.instruction).toContain('POLICY_BLOCKED: full-suite budget exhausted')
    const telemetry = JSON.parse(readFileSync(join(root, '.pipeline/remote-jobs.json'), 'utf8'))
    expect(telemetry.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ operation_id: 'full-2', status: 'blocked' })]))
    expect(telemetry.summary.blocked).toBe(1)
  })

  it('does not consume a full-suite build budget when a prior artifact is reused', async () => {
    const root = gitTempRoot('release_adapter: ".claude/release-adapter.json"\n')
    writeReleaseAdapter(root, { budgets: { max_remote_jobs_per_candidate: 3, max_full_suites_per_candidate: 1, max_production_builds_per_candidate: 1 } })
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Reuse exact artifacts', criteria: ['reuse stays cheap'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    expect((await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'reuse-1', jobKind: 'full-suite', jobStatus: 'reserve', artifactAction: 'reused' })).exitCode).toBe(0)
    expect((await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'build-1', jobKind: 'full-suite', jobStatus: 'reserve', artifactAction: 'built' })).exitCode).toBe(0)
    const blocked = await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'build-2', jobKind: 'full-suite', jobStatus: 'reserve', artifactAction: 'built' })
    expect(blocked.instruction).toContain('full-suite budget exhausted')
  })

  it('can close a reserved remote job after candidate drift', async () => {
    const root = gitTempRoot('release_adapter: ".claude/release-adapter.json"\n')
    writeReleaseAdapter(root)
    await runYallaRun({ command: 'goal', rootDir: root, message: 'Close remote telemetry', criteria: ['terminal job state'] })
    await runYallaRun({ command: 'candidate', rootDir: root, issueId: 'issue-47' })
    expect((await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'full-drift', jobKind: 'full-suite', jobStatus: 'reserve', artifactAction: 'built' })).exitCode).toBe(0)
    writeFileSync(join(root, 'app.ts'), 'export const value = 2\n')

    const completed = await runYallaRun({ command: 'remote-job', rootDir: root, operationId: 'full-drift', jobKind: 'full-suite', jobStatus: 'succeeded', artifactAction: 'built', durationSeconds: 45 })
    expect(completed.status?.status).toBe('updated')
    expect((completed.status?.job as Record<string, unknown>)?.status).toBe('succeeded')
  })
})
