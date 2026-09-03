import { describe, expect, it } from 'vitest'
import { validateEvidenceGates } from '../../eval/yalla/schemas/evidence-gates.js'
import { runEvidenceGateFixtures } from '../../eval/yalla/runner/evidence-gates-runner.js'

describe('Yalla evidence gates', () => {
  it('keeps P0 evidence-gate regressions in the smoke harness', () => {
    const report = runEvidenceGateFixtures()

    expect(report.passed).toBe(true)
    expect(report.summary.before_patch_failures).toBeGreaterThan(0)
    expect(report.summary.p0_legacy_failing).toBe(true)
    expect(report.summary.p0_patched_passing).toBe(true)
    expect(report.summary.held_out_passing).toBe(true)
  })

  it('rejects ungrounded external-provider claims and unresolved runtime proof gaps', () => {
    const violations = validateEvidenceGates({
      external_grounding: { applies: true, trigger: 'provider API', verdict: 'inconclusive' },
      runtime_e2e_preflight: {
        applies: true,
        environment: 'preview',
        base_ref: 'main',
        skip_classification: 'unresolved-proof-gap',
        status: 'blocked',
      },
    })

    expect(violations.map(violation => violation.message)).toContain('Applicable external behavior must be grounded before it can support PROVEN.')
    expect(violations.map(violation => violation.message)).toContain('An unresolved runtime proof gap cannot support PROVEN.')
  })

  it('requires generative evidence only for the gates that apply', () => {
    const violations = validateEvidenceGates({
      surface_parity: { applies: true, reason: 'new API route', family: 'API routes' },
      trust_map: { applies: false, reason: 'no external input or output' },
      volume_envelope: { applies: false, reason: 'constant-size local operation', busiest_case: 'n/a', cost_math: 'n/a' },
      lifecycle_states: { applies: false, reason: 'no stateful provider object' },
    })

    expect(violations.map(violation => violation.path)).toEqual(expect.arrayContaining(['surface_parity.siblings', 'surface_parity.inherited_concerns']))
    expect(violations.some(violation => violation.path.startsWith('trust_map'))).toBe(false)
  })

  it('accepts bounded, grounded evidence without requiring Factory-specific policy', () => {
    expect(validateEvidenceGates({
      external_grounding: {
        applies: true,
        trigger: 'provider retry semantics',
        verdict: 'grounded',
        sources_checked: [{ source_type: 'official-docs', name: 'Provider API', url_or_path: 'https://example.com/docs', accessed_at: '2026-09-03', claims: ['429 responses are retryable.'] }],
        implementation_effects: ['Retry only retryable responses.'],
      },
      runtime_e2e_preflight: {
        applies: true,
        environment: 'preview',
        base_ref: 'main@abc123',
        required_shape: ['test account present'],
        mutation_guardrails: ['No production writes.'],
        skip_classification: 'intentional-guard-skip',
        inherited_base_failures: [],
        proves: ['Preview route renders a retryable provider error.'],
        does_not_prove: ['A real production charge.'],
        status: 'pass',
      },
      surface_parity: {
        applies: true,
        reason: 'new public API route',
        family: 'public API routes',
        siblings: ['api/example-a.ts', 'api/example-b.ts'],
        inherited_concerns: [{ concern: 'auth and error taxonomy', decision: 'applied', evidence: 'matches both siblings' }],
      },
      trust_map: { applies: true, reason: 'user input is rendered', inputs: [{ field_or_source: 'displayName', writer: 'anonymous user', hostile: true, neutralization: 'validated and escaped' }], outputs: [] },
      volume_envelope: { applies: true, reason: 'per-item provider calls', busiest_case: '500 records', cost_math: '500 calls at concurrency 10 within 60 seconds', collection_or_call_bounds: ['paginate 100 records per page; stop after 5 pages'] },
      lifecycle_states: { applies: true, reason: 'provider object is stateful', objects: [{ object: 'provider job', states: ['pending', 'complete', 'failed'], behavior_by_state: ['poll pending', 'return complete', 'persist failure'], negative_test: 'failed job cannot report completion' }] },
      ui_proof: { applies: true, revision: 'abc123', assertions: ['Inline error appears under the field.'], artifacts: ['.artifacts/issue-44/field-error.png'], sensitive_data_excluded: true, external_upload: false },
    })).toEqual([])
  })
})
