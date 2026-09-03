import { describe, expect, it } from 'vitest'
import { validateProofContract } from '../../eval/yalla/schemas/proof-contract.js'
import { runProofContractFixtures } from '../../eval/yalla/runner/proof-contract-runner.js'

describe('yalla proof contract', () => {
  it('passes P0 fixtures while proving legacy samples fail', () => {
    const report = runProofContractFixtures()

    expect(report.passed).toBe(true)
    expect(report.summary.before_patch_failures).toBeGreaterThan(0)
    expect(report.summary.p0_legacy_failing).toBe(true)
    expect(report.summary.p0_patched_passing).toBe(true)
    expect(report.summary.held_out_passing).toBe(true)
  })

  it('rejects model-judge proof when a deterministic seam exists', () => {
    const result = validateProofContract({
      issue_id: 'issue-1166',
      issue_intent: {
        summary: 'Validate concrete behavior.',
        user_visible_promise: 'Users see deterministic behavior.',
      },
      acceptance_criteria: [
        {
          id: 'ac-1',
          description: 'Concrete API response matches contract.',
          negative_path: true,
          proof_mode: 'model-judge',
          deterministic_seam_available: true,
          status: 'covered',
          evidence: 'LLM says it looks right.',
        },
      ],
      implementation_evidence: {
        changed_surfaces: ['api/example.ts'],
        equivalent_surfaces_checked: [],
        commands: [{ command: 'manual review', status: 'pass', summary: 'Looked at code.' }],
      },
      review_evidence: {
        required_checks: ['evidence-check'],
        checks: [{ name: 'evidence-check', verdict: 'pass', findings: [] }],
        review_triggered_edits: [],
      },
      outcome: {
        verdict: 'PROVEN',
        remaining_delta: [],
        pr_reviewability: {
          summary: 'Ready.',
          risks: [],
          human_decisions_needed: [],
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.violations.map(violation => violation.message)).toContain(
      'Model-judge proof is forbidden when a deterministic seam exists.'
    )
  })

  it('does not allow INCONCLUSIVE to be disguised as covered proof', () => {
    const result = validateProofContract({
      issue_id: 'issue-1166',
      issue_intent: {
        summary: 'Verify blocked browser flow.',
        user_visible_promise: 'Customer flow works.',
      },
      acceptance_criteria: [
        {
          id: 'ac-1',
          description: 'Blocked journey is not called proven.',
          negative_path: true,
          proof_mode: 'inconclusive',
          deterministic_seam_available: true,
          status: 'covered',
          evidence: 'Browser unavailable.',
        },
      ],
      implementation_evidence: {
        changed_surfaces: ['src/pages/Dashboard.tsx'],
        equivalent_surfaces_checked: [],
        commands: [{ command: 'npm run test:e2e', status: 'blocked', summary: 'Browser unavailable.' }],
      },
      review_evidence: {
        required_checks: ['evidence-check'],
        checks: [{ name: 'evidence-check', verdict: 'blocked', findings: ['Browser unavailable.'] }],
        review_triggered_edits: [],
      },
      outcome: {
        verdict: 'PROVEN',
        remaining_delta: [],
        pr_reviewability: {
          summary: 'Done.',
          risks: [],
          human_decisions_needed: [],
        },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.violations.some(violation => violation.message.includes('Inconclusive proof'))).toBe(true)
    expect(result.violations.some(violation => violation.message.includes('PROVEN requires all evidence commands'))).toBe(true)
  })

  it('does not allow an ungrounded boundary claim to be disguised as proven proof', () => {
    const result = validateProofContract({
      issue_id: 'issue-44',
      issue_intent: {
        summary: 'Use the provider retry contract safely.',
        user_visible_promise: 'Provider retry behavior is handled correctly.',
      },
      acceptance_criteria: [
        {
          id: 'ac-1',
          description: 'Retry behavior follows the provider contract.',
          negative_path: true,
          proof_mode: 'new-test',
          deterministic_seam_available: true,
          status: 'covered',
          evidence: 'tests/provider-retry.test.ts',
          boundary_proof: {
            required: true,
            seam: 'provider adapter',
            false_success_condition: 'A local fake can accept retry behavior the provider rejects.',
            status: 'not-proven',
          },
        },
      ],
      implementation_evidence: {
        changed_surfaces: ['src/provider-adapter.ts'],
        equivalent_surfaces_checked: [],
        commands: [{ command: 'npm test -- provider-retry', status: 'pass', summary: 'Targeted provider retry test passes.' }],
      },
      review_evidence: {
        required_checks: ['external-grounding-check'],
        checks: [{ name: 'external-grounding-check', verdict: 'pass', findings: [] }],
        review_triggered_edits: [],
      },
      evidence_gates: {
        external_grounding: { applies: true, trigger: 'provider retry contract', verdict: 'inconclusive' },
      },
      outcome: {
        verdict: 'PROVEN',
        remaining_delta: [],
        pr_reviewability: { summary: 'Ready.', risks: [], human_decisions_needed: [] },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.violations.some(violation => violation.message.includes('covered boundary proof'))).toBe(true)
    expect(result.violations.some(violation => violation.message.includes('must be grounded'))).toBe(true)
  })

  it('does not allow PROVEN to omit evidence for an applicable required gate', () => {
    const result = validateProofContract({
      issue_id: 'issue-44',
      issue_intent: {
        summary: 'Use the provider contract safely.',
        user_visible_promise: 'Provider behavior is correct.',
      },
      acceptance_criteria: [
        {
          id: 'ac-1',
          description: 'Provider behavior follows the current contract.',
          negative_path: true,
          proof_mode: 'new-test',
          deterministic_seam_available: true,
          status: 'covered',
          evidence: 'tests/provider-contract.test.ts',
        },
      ],
      implementation_evidence: {
        changed_surfaces: ['src/provider-adapter.ts'],
        equivalent_surfaces_checked: [],
        commands: [{ command: 'npm test -- provider-contract', status: 'pass', summary: 'Pass.' }],
      },
      review_evidence: {
        required_checks: ['external-grounding-check'],
        checks: [{ name: 'external-grounding-check', verdict: 'pass', findings: [] }],
        review_triggered_edits: [],
      },
      outcome: {
        verdict: 'PROVEN',
        remaining_delta: [],
        pr_reviewability: { summary: 'Ready.', risks: [], human_decisions_needed: [] },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.violations).toContainEqual({
      path: 'evidence_gates.external_grounding',
      message: 'PROVEN requires an explicit external_grounding decision: applicable evidence or a concrete N/A reason.',
    })
    expect(result.violations.filter(violation => violation.message.includes('explicit') && violation.message.includes('decision'))).toHaveLength(7)
  })

  it('does not allow review to drop a gate armed during classification', () => {
    const run = {
      issue_id: 'issue-44',
      issue_intent: {
        summary: 'Use the provider contract safely.',
        user_visible_promise: 'Provider behavior is correct.',
      },
      acceptance_criteria: [
        {
          id: 'ac-1',
          description: 'Provider behavior follows the current contract.',
          negative_path: true,
          proof_mode: 'new-test',
          deterministic_seam_available: true,
          status: 'covered',
          evidence: 'tests/provider-contract.test.ts',
        },
      ],
      implementation_evidence: {
        changed_surfaces: ['src/provider-adapter.ts'],
        equivalent_surfaces_checked: [],
        commands: [{ command: 'npm test -- provider-contract', status: 'pass', summary: 'Pass.' }],
      },
      review_evidence: {
        required_checks: ['correctness-check'],
        checks: [{ name: 'correctness-check', verdict: 'pass', findings: [] }],
        review_triggered_edits: [],
      },
      classification_evidence: { required_gates: ['correctness-check', 'external-grounding-check'] },
      evidence_gates: {
        external_grounding: { applies: false, reason: 'Incorrectly downgraded after classification.' },
        runtime_e2e_preflight: { applies: false, reason: 'No real-environment proof is claimed.' },
        surface_parity: { applies: false, reason: 'No public entrypoint is added.' },
        trust_map: { applies: false, reason: 'No new trust boundary.' },
        volume_envelope: { applies: false, reason: 'No collection or per-item work.' },
        lifecycle_states: { applies: false, reason: 'No stateful external object.' },
        ui_proof: { applies: false, reason: 'No UI claim.' },
      },
      outcome: {
        verdict: 'PROVEN',
        remaining_delta: [],
        pr_reviewability: { summary: 'Ready.', risks: [], human_decisions_needed: [] },
      },
    }
    const result = validateProofContract(run)

    expect(result.valid).toBe(false)
    expect(result.violations.map(violation => violation.message)).toEqual(expect.arrayContaining([
      'external-grounding-check was armed during classification and cannot be dropped before PROVEN.',
      'external-grounding-check was armed during classification, so its evidence gate cannot be marked N/A for PROVEN.',
    ]))

    const inverseDrift = {
      ...run,
      classification_evidence: { required_gates: ['correctness-check'] },
      review_evidence: {
        ...run.review_evidence,
        required_checks: ['correctness-check', 'external-grounding-check'],
        checks: [
          ...run.review_evidence.checks,
          { name: 'external-grounding-check', verdict: 'pass', findings: [] },
        ],
      },
      evidence_gates: {
        ...run.evidence_gates,
        external_grounding: {
          applies: true,
          trigger: 'provider contract',
          verdict: 'grounded',
          sources_checked: [
            {
              source_type: 'official-docs',
              name: 'Provider docs',
              url_or_path: 'https://example.com/provider',
              accessed_at: '2026-09-03',
              claims: ['The provider behavior is current.'],
            },
          ],
          implementation_effects: ['Follow the provider contract.'],
          missing_evidence: [],
        },
      },
    }

    const inverseResult = validateProofContract(inverseDrift)
    expect(inverseResult.valid).toBe(false)
    expect(inverseResult.violations.map(violation => violation.message)).toContain(
      'external-grounding-check became applicable after classification and must be persisted before PROVEN.'
    )
  })

  it('keeps honest inconclusive evidence structurally valid', () => {
    const result = validateProofContract({
      issue_id: 'issue-44',
      issue_intent: {
        summary: 'Check a provider behavior that cannot currently be verified.',
        user_visible_promise: 'Provider behavior is reported honestly.',
      },
      acceptance_criteria: [
        {
          id: 'ac-1',
          description: 'Record the unresolved provider behavior.',
          negative_path: true,
          proof_mode: 'inconclusive',
          deterministic_seam_available: false,
          status: 'blocked',
          evidence: 'Provider sandbox unavailable.',
        },
      ],
      implementation_evidence: {
        changed_surfaces: ['src/provider-adapter.ts'],
        equivalent_surfaces_checked: [],
        commands: [{ command: 'provider sandbox check', status: 'blocked', summary: 'Sandbox unavailable.' }],
      },
      review_evidence: {
        required_checks: ['external-grounding-check', 'runtime-e2e-proof-check'],
        checks: [
          { name: 'external-grounding-check', verdict: 'blocked', findings: ['Current provider behavior is unresolved.'] },
          { name: 'runtime-e2e-proof-check', verdict: 'blocked', findings: ['Provider sandbox unavailable.'] },
        ],
        review_triggered_edits: [],
      },
      evidence_gates: {
        external_grounding: {
          applies: true,
          trigger: 'provider behavior',
          verdict: 'inconclusive',
          missing_evidence: ['Current provider response contract.'],
        },
        runtime_e2e_preflight: {
          applies: true,
          environment: 'provider sandbox',
          base_ref: 'main@abc123',
          target_ref: 'preview@def456',
          skip_classification: 'unresolved-proof-gap',
          proves: [],
          status: 'blocked',
        },
      },
      outcome: {
        verdict: 'INCONCLUSIVE',
        remaining_delta: ['Provider sandbox proof is unavailable.'],
        pr_reviewability: {
          summary: 'Requires external evidence.',
          risks: ['Provider behavior remains unverified.'],
          human_decisions_needed: ['Decide whether to wait for provider sandbox access.'],
        },
      },
    })

    expect(result).toEqual({ valid: true, verdict: 'INCONCLUSIVE', violations: [] })
  })
})
