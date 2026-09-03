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
})
