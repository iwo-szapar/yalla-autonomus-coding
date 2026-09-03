import { z } from 'zod'
import { evidenceGatesSchema, validateEvidenceGates, type EvidenceGates } from './evidence-gates.js'

export const proofModeSchema = z.enum([
  'existing-test',
  'new-test',
  'playwright',
  'static-artifact',
  'manual-smoke',
  'model-judge',
  'inconclusive',
])

export const outcomeVerdictSchema = z.enum(['PROVEN', 'NOT_PROVEN', 'INCONCLUSIVE'])

export const commandEvidenceSchema = z.object({
  command: z.string().min(1),
  status: z.enum(['pass', 'fail', 'blocked', 'not-run']),
  summary: z.string().min(1),
})

export const acceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  negative_path: z.boolean(),
  proof_mode: proofModeSchema,
  deterministic_seam_available: z.boolean(),
  status: z.enum(['pending', 'covered', 'accepted-risk', 'blocked']),
  proof_ref: z.string().min(1).optional(),
  evidence: z.string().min(1).optional(),
  boundary_proof: z
    .object({
      required: z.boolean(),
      seam: z.string().min(1).optional(),
      false_success_condition: z.string().min(1).optional(),
      status: z.enum(['covered', 'not-proven', 'n/a']),
    })
    .optional(),
})

export const reviewCheckSchema = z.object({
  name: z.string().min(1),
  verdict: z.enum(['pass', 'fail', 'blocked']),
  findings: z.array(z.string()).default([]),
})

const classificationEvidenceSchema = z.object({
  required_gates: z.array(z.string().min(1)),
})

export const proofContractRunSchema = z.object({
  issue_id: z.string().regex(/^issue-\d+$/),
  issue_intent: z.object({
    summary: z.string().min(1),
    user_visible_promise: z.string().min(1),
  }),
  acceptance_criteria: z.array(acceptanceCriterionSchema).min(1),
  implementation_evidence: z.object({
    changed_surfaces: z.array(z.string()).default([]),
    equivalent_surfaces_checked: z.array(z.string()).default([]),
    commands: z.array(commandEvidenceSchema).default([]),
  }),
  review_evidence: z.object({
    required_checks: z.array(z.string()).min(1),
    checks: z.array(reviewCheckSchema).min(1),
    review_triggered_edits: z
      .array(
        z.object({
          description: z.string().min(1),
          rerun_commands: z.array(commandEvidenceSchema).default([]),
        })
      )
      .default([]),
  }),
  classification_evidence: classificationEvidenceSchema.optional(),
  evidence_gates: evidenceGatesSchema.optional(),
  outcome: z.object({
    verdict: outcomeVerdictSchema,
    remaining_delta: z.array(z.string()).default([]),
    pr_reviewability: z.object({
      summary: z.string().min(1),
      risks: z.array(z.string()).default([]),
      human_decisions_needed: z.array(z.string()).default([]),
    }),
  }),
})

export type ProofContractRun = z.infer<typeof proofContractRunSchema>

export type ProofContractViolation = {
  path: string
  message: string
}

export type ProofContractValidation = {
  valid: boolean
  verdict: z.infer<typeof outcomeVerdictSchema> | 'INVALID'
  violations: ProofContractViolation[]
}

const checkoutSurfaces = ['src/pages/CheckoutPage.tsx', 'src/pages/PublicProduct.tsx']

const evidenceGateForReviewCheck = {
  'external-grounding-check': 'external_grounding',
  'runtime-e2e-proof-check': 'runtime_e2e_preflight',
  'surface-parity-check': 'surface_parity',
  'trust-map-check': 'trust_map',
  'volume-envelope-check': 'volume_envelope',
  'lifecycle-state-check': 'lifecycle_states',
  'ui-proof-check': 'ui_proof',
} as const satisfies Record<string, keyof EvidenceGates>

const evidenceGateNames = Object.values(evidenceGateForReviewCheck)

function addViolation(violations: ProofContractViolation[], path: string, message: string) {
  violations.push({ path, message })
}

function touchesCheckoutSurface(changedSurfaces: string[]) {
  return changedSurfaces.some(surface => checkoutSurfaces.includes(surface) || surface.includes('/checkout') || surface.includes('/p/'))
}

export function validateProofContract(input: unknown): ProofContractValidation {
  const parsed = proofContractRunSchema.safeParse(input)
  if (!parsed.success) {
    return {
      valid: false,
      verdict: 'INVALID',
      violations: parsed.error.issues.map(issue => ({
        path: issue.path.join('.') || '<root>',
        message: issue.message,
      })),
    }
  }

  const run = parsed.data
  const violations: ProofContractViolation[] = []

  if (!run.acceptance_criteria.some(criterion => criterion.negative_path)) {
    addViolation(violations, 'acceptance_criteria', 'At least one criterion must cover a negative or false-success path.')
  }

  for (const criterion of run.acceptance_criteria) {
    if (criterion.proof_mode === 'model-judge' && criterion.deterministic_seam_available) {
      addViolation(
        violations,
        `acceptance_criteria.${criterion.id}.proof_mode`,
        'Model-judge proof is forbidden when a deterministic seam exists.'
      )
    }

    if (criterion.status === 'covered' && !criterion.proof_ref && !criterion.evidence) {
      addViolation(
        violations,
        `acceptance_criteria.${criterion.id}.evidence`,
        'Covered criteria must point to concrete proof evidence.'
      )
    }

    if (criterion.status === 'covered' && criterion.proof_mode === 'inconclusive') {
      addViolation(
        violations,
        `acceptance_criteria.${criterion.id}.proof_mode`,
        'Inconclusive proof cannot mark a criterion as covered.'
      )
    }

    if (criterion.boundary_proof?.required) {
      if (!criterion.boundary_proof.seam || !criterion.boundary_proof.false_success_condition) {
        addViolation(
          violations,
          `acceptance_criteria.${criterion.id}.boundary_proof`,
          'Required boundary proof must name the seam and the false-success condition it excludes.'
        )
      }
      if (criterion.status === 'covered' && criterion.boundary_proof.status !== 'covered') {
        addViolation(
          violations,
          `acceptance_criteria.${criterion.id}.boundary_proof.status`,
          'A covered criterion needs covered boundary proof when that proof is required.'
        )
      }
    }
  }

  if (run.outcome.verdict === 'PROVEN') {
    if (!run.classification_evidence) {
      addViolation(
        violations,
        'classification_evidence',
        'PROVEN requires the persisted classification required_gates so later review cannot silently drop an armed gate.'
      )
    }

    for (const gateName of evidenceGateNames) {
      if (!run.evidence_gates?.[gateName]) {
        addViolation(
          violations,
          `evidence_gates.${gateName}`,
          `PROVEN requires an explicit ${gateName} decision: applicable evidence or a concrete N/A reason.`
        )
      }
    }

    for (const requiredCheck of run.review_evidence.required_checks) {
      const gateName = evidenceGateForReviewCheck[requiredCheck as keyof typeof evidenceGateForReviewCheck]
      if (!gateName) continue

      const gate = run.evidence_gates?.[gateName]
      if (!gate) {
        continue
      } else if (!gate.applies) {
        addViolation(
          violations,
          `evidence_gates.${gateName}.applies`,
          `${requiredCheck} is required, so its evidence gate cannot be marked N/A for PROVEN.`
        )
      }
    }

    for (const requiredCheck of Object.keys(evidenceGateForReviewCheck) as Array<keyof typeof evidenceGateForReviewCheck>) {
      const gateName = evidenceGateForReviewCheck[requiredCheck]
      const classifiedAsRequired = run.classification_evidence?.required_gates.includes(requiredCheck) ?? false
      const reviewedAsRequired = run.review_evidence.required_checks.includes(requiredCheck)
      const gateApplies = run.evidence_gates?.[gateName]?.applies ?? false

      if (classifiedAsRequired && !reviewedAsRequired) {
        addViolation(
          violations,
          'review_evidence.required_checks',
          `${requiredCheck} was armed during classification and cannot be dropped before PROVEN.`
        )
      }
      if (classifiedAsRequired && !gateApplies) {
        addViolation(
          violations,
          `evidence_gates.${gateName}.applies`,
          `${requiredCheck} was armed during classification, so its evidence gate cannot be marked N/A for PROVEN.`
        )
      }
      if (gateApplies && !reviewedAsRequired) {
        addViolation(
          violations,
          'review_evidence.required_checks',
          `Applicable ${gateName} evidence requires ${requiredCheck} before PROVEN.`
        )
      }
      if ((gateApplies || reviewedAsRequired) && !classifiedAsRequired) {
        addViolation(
          violations,
          'classification_evidence.required_gates',
          `${requiredCheck} became applicable after classification and must be persisted before PROVEN.`
        )
      }
    }
  }

  if (run.evidence_gates) {
    const evidenceGateViolations = validateEvidenceGates(run.evidence_gates, {
      requireReadyForProven: run.outcome.verdict === 'PROVEN',
    })
    for (const violation of evidenceGateViolations) {
      addViolation(violations, `evidence_gates.${violation.path}`, violation.message)
    }
  }

  if (touchesCheckoutSurface(run.implementation_evidence.changed_surfaces)) {
    for (const surface of checkoutSurfaces) {
      if (!run.implementation_evidence.equivalent_surfaces_checked.includes(surface)) {
        addViolation(
          violations,
          'implementation_evidence.equivalent_surfaces_checked',
          `Checkout/public product parity requires checking ${surface}.`
        )
      }
    }
  }

  const reviewChecks = new Map(run.review_evidence.checks.map(check => [check.name, check]))
  for (const requiredCheck of run.review_evidence.required_checks) {
    const check = reviewChecks.get(requiredCheck)
    if (!check) {
      addViolation(violations, 'review_evidence.checks', `Missing required review check: ${requiredCheck}.`)
    } else if (run.outcome.verdict === 'PROVEN' && check.verdict !== 'pass') {
      addViolation(violations, `review_evidence.checks.${requiredCheck}`, `Required review check is ${check.verdict}.`)
    }
  }

  for (const edit of run.review_evidence.review_triggered_edits) {
    if (edit.rerun_commands.length === 0 || edit.rerun_commands.some(command => command.status !== 'pass')) {
      addViolation(
        violations,
        'review_evidence.review_triggered_edits',
        'Review-triggered edits must rerun relevant checks and pass.'
      )
    }
  }

  if (run.outcome.verdict === 'PROVEN') {
    if (run.acceptance_criteria.some(criterion => criterion.status !== 'covered')) {
      addViolation(violations, 'outcome.verdict', 'PROVEN requires every acceptance criterion to be covered.')
    }

    if (run.implementation_evidence.commands.length === 0) {
      addViolation(violations, 'implementation_evidence.commands', 'PROVEN requires implementation evidence commands.')
    }

    if (run.implementation_evidence.commands.some(command => command.status !== 'pass')) {
      addViolation(violations, 'implementation_evidence.commands', 'PROVEN requires all evidence commands to pass.')
    }

    if (run.review_evidence.checks.some(check => check.verdict !== 'pass')) {
      addViolation(violations, 'review_evidence.checks', 'PROVEN requires all review checks to pass.')
    }

    if (run.outcome.remaining_delta.length > 0) {
      addViolation(violations, 'outcome.remaining_delta', 'PROVEN cannot have remaining delta.')
    }
  }

  if (run.outcome.verdict === 'INCONCLUSIVE' && run.outcome.pr_reviewability.human_decisions_needed.length === 0) {
    addViolation(
      violations,
      'outcome.pr_reviewability.human_decisions_needed',
      'INCONCLUSIVE outcomes must name the human decision or external evidence still needed.'
    )
  }

  return {
    valid: violations.length === 0,
    verdict: run.outcome.verdict,
    violations,
  }
}
