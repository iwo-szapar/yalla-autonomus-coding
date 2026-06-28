import { describe, expect, it } from 'vitest'
import { runSandboxProofFixtures } from '../../eval/yalla/runner/sandbox-proof-runner.js'
import { validateSandboxEvidenceRecord, validateSandboxProof } from '../../eval/yalla/schemas/sandbox-proof.js'

function validProof() {
  return {
    schema_version: 1,
    issue_id: 'issue-3001',
    profile: 'fast',
    provider: 'local',
    sandbox_id: 'local-test',
    started_at: '2026-06-25T10:00:00.000Z',
    completed_at: '2026-06-25T10:01:00.000Z',
    git: {
      base_sha: 'abc123',
      dirty_diff_sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      changed_files: ['docs/testing/README.md'],
    },
    isolation: {
      workspace: 'clean-copy',
      app_server: 'not-required',
      database: 'not-required',
      network: 'provider-default',
    },
    commands: [
      {
        command: 'npm test',
        status: 'pass',
        exit_code: 0,
        duration_ms: 100,
        stdout_ref: '.pipeline/agent-sandbox-artifacts/run/stdout.log',
        stderr_ref: '.pipeline/agent-sandbox-artifacts/run/stderr.log',
      },
    ],
    artifacts: [
      {
        kind: 'log',
        path: '.pipeline/agent-sandbox-artifacts/run/stdout.log',
        sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    ],
    redaction: {
      status: 'pass',
      patterns_checked: ['token', 'secret'],
    },
    teardown: {
      status: 'pass',
      completed_at: '2026-06-25T10:01:00.000Z',
    },
    verdict: 'PROVEN',
  } as const
}

describe('yalla sandbox proof evals', () => {
  it('passes the fixture suite', () => {
    const report = runSandboxProofFixtures()

    expect(report.passed).toBe(true)
    expect(report.summary.total).toBe(7)
    expect(report.summary.fixtures_matched).toBe(true)
  })

  it('rejects high-risk PROVEN outcomes without sandbox proof', () => {
    const result = validateSandboxEvidenceRecord({
      issue_id: 'issue-3001',
      risk: 'high',
      outcome_verdict: 'PROVEN',
      changed_surfaces: ['api/checkout/create-session.ts'],
    })

    expect(result.valid).toBe(false)
    expect(result.violations.map(violation => violation.message)).toContain('PROVEN high-risk work requires sandbox proof.')
  })

  it('allows accepted risk only as INCONCLUSIVE without proof', () => {
    const accepted = validateSandboxEvidenceRecord({
      issue_id: 'issue-3001',
      risk: 'high',
      outcome_verdict: 'INCONCLUSIVE',
      accepted_risk: true,
      changed_surfaces: ['api/checkout/create-session.ts'],
    })

    const fakeProven = validateSandboxEvidenceRecord({
      issue_id: 'issue-3001',
      risk: 'high',
      outcome_verdict: 'PROVEN',
      accepted_risk: true,
      changed_surfaces: ['api/checkout/create-session.ts'],
    })

    expect(accepted.valid).toBe(true)
    expect(fakeProven.valid).toBe(false)
    expect(fakeProven.violations.map(violation => violation.message)).toContain(
      'Accepted risk can justify INCONCLUSIVE, not PROVEN without sandbox proof.'
    )
  })

  it('rejects artifact path traversal', () => {
    const proof = validProof()
    const result = validateSandboxProof({
      ...proof,
      artifacts: [{ ...proof.artifacts[0], path: '../secret.log' }],
    })

    expect(result.valid).toBe(false)
    expect(result.violations.map(violation => violation.message)).toContain(
      'Artifact paths must stay under .pipeline/agent-sandbox-artifacts/.'
    )
  })

  it('rejects schema proof without isolated DB evidence', () => {
    const result = validateSandboxProof({
      ...validProof(),
      profile: 'schema',
      isolation: { ...validProof().isolation, database: 'not-required' },
    })

    expect(result.valid).toBe(false)
    expect(result.violations.map(violation => violation.message)).toContain('schema proof requires isolated database evidence.')
  })

  it('rejects likely secrets anywhere in the proof payload', () => {
    const result = validateSandboxProof({
      ...validProof(),
      sandbox_id: 'SBF_FAKE_SECRET_TEST_VALUE',
    })

    expect(result.valid).toBe(false)
    expect(result.violations.some(violation => violation.message.includes('likely secret'))).toBe(true)
  })
})
