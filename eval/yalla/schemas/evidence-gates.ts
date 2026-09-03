import { z } from 'zod'

const nonEmpty = z.string().min(1)
const gateStatus = z.enum(['pass', 'blocked', 'n/a'])

const externalSourceSchema = z.object({
  source_type: z.enum(['official-docs', 'upstream-source', 'standards', 'local-contract']),
  name: nonEmpty,
  url_or_path: nonEmpty,
  accessed_at: nonEmpty,
  claims: z.array(nonEmpty).min(1),
})

const externalGroundingSchema = z.object({
  applies: z.boolean(),
  trigger: nonEmpty,
  verdict: z.enum(['grounded', 'inconclusive', 'n/a']),
  sources_checked: z.array(externalSourceSchema).default([]),
  implementation_effects: z.array(nonEmpty).default([]),
  missing_evidence: z.array(nonEmpty).default([]),
})

const runtimeE2ePreflightSchema = z.object({
  applies: z.boolean(),
  environment: nonEmpty,
  base_ref: nonEmpty,
  required_shape: z.array(nonEmpty).default([]),
  mutation_guardrails: z.array(nonEmpty).default([]),
  skip_classification: z.enum(['none', 'intentional-guard-skip', 'unresolved-proof-gap']),
  inherited_base_failures: z.array(nonEmpty).default([]),
  proves: z.array(nonEmpty).default([]),
  does_not_prove: z.array(nonEmpty).default([]),
  status: gateStatus,
})

const surfaceParitySchema = z.object({
  applies: z.boolean(),
  reason: nonEmpty,
  family: nonEmpty,
  siblings: z.array(nonEmpty).default([]),
  inherited_concerns: z
    .array(z.object({ concern: nonEmpty, decision: z.enum(['applied', 'divergence-justified']), evidence: nonEmpty }))
    .default([]),
})

const trustMapSchema = z.object({
  applies: z.boolean(),
  reason: nonEmpty,
  inputs: z
    .array(z.object({ field_or_source: nonEmpty, writer: nonEmpty, hostile: z.boolean(), neutralization: nonEmpty }))
    .default([]),
  outputs: z
    .array(z.object({ artifact: nonEmpty, consumer_context: nonEmpty, escaping_or_guard: nonEmpty }))
    .default([]),
})

const volumeEnvelopeSchema = z.object({
  applies: z.boolean(),
  reason: nonEmpty,
  busiest_case: nonEmpty,
  cost_math: nonEmpty,
  collection_or_call_bounds: z.array(nonEmpty).default([]),
})

const lifecycleStatesSchema = z.object({
  applies: z.boolean(),
  reason: nonEmpty,
  objects: z
    .array(
      z.object({
        object: nonEmpty,
        states: z.array(nonEmpty).min(1),
        behavior_by_state: z.array(nonEmpty).min(1),
        negative_test: nonEmpty,
      })
    )
    .default([]),
})

const uiProofSchema = z.object({
  applies: z.boolean(),
  revision: nonEmpty,
  assertions: z.array(nonEmpty).default([]),
  artifacts: z.array(nonEmpty).default([]),
  sensitive_data_excluded: z.boolean(),
  external_upload: z.literal(false),
})

export const evidenceGatesSchema = z.object({
  external_grounding: externalGroundingSchema.optional(),
  runtime_e2e_preflight: runtimeE2ePreflightSchema.optional(),
  surface_parity: surfaceParitySchema.optional(),
  trust_map: trustMapSchema.optional(),
  volume_envelope: volumeEnvelopeSchema.optional(),
  lifecycle_states: lifecycleStatesSchema.optional(),
  ui_proof: uiProofSchema.optional(),
})

export type EvidenceGates = z.infer<typeof evidenceGatesSchema>

export type EvidenceGatesViolation = { path: string; message: string }

export function validateEvidenceGates(input: unknown): EvidenceGatesViolation[] {
  const parsed = evidenceGatesSchema.safeParse(input)
  if (!parsed.success) {
    return parsed.error.issues.map(issue => ({ path: issue.path.join('.') || '<root>', message: issue.message }))
  }

  const gates = parsed.data
  const violations: EvidenceGatesViolation[] = []
  const add = (path: string, message: string) => violations.push({ path, message })

  if (gates.external_grounding?.applies) {
    if (gates.external_grounding.verdict !== 'grounded') add('external_grounding.verdict', 'Applicable external behavior must be grounded before it can support PROVEN.')
    if (gates.external_grounding.sources_checked.length === 0) add('external_grounding.sources_checked', 'Applicable external grounding needs current claim-specific sources.')
  }

  if (gates.runtime_e2e_preflight?.applies) {
    if (gates.runtime_e2e_preflight.skip_classification === 'unresolved-proof-gap') add('runtime_e2e_preflight.skip_classification', 'An unresolved runtime proof gap cannot support PROVEN.')
    if (gates.runtime_e2e_preflight.proves.length === 0) add('runtime_e2e_preflight.proves', 'Runtime preflight must state the exact claim it can prove.')
  }

  if (gates.surface_parity?.applies) {
    if (gates.surface_parity.siblings.length < 2) add('surface_parity.siblings', 'Surface parity needs at least two nearest siblings, or a recorded N/A reason.')
    if (gates.surface_parity.inherited_concerns.length === 0) add('surface_parity.inherited_concerns', 'Surface parity must enumerate inherited concerns or justified divergences.')
  }

  if (gates.trust_map?.applies && gates.trust_map.inputs.length + gates.trust_map.outputs.length === 0) add('trust_map', 'Trust map must enumerate consumed inputs or emitted outputs.')
  if (gates.volume_envelope?.applies && gates.volume_envelope.collection_or_call_bounds.length === 0) add('volume_envelope.collection_or_call_bounds', 'Volume envelope must state a pagination, concurrency, or timeout bound.')
  if (gates.lifecycle_states?.applies && gates.lifecycle_states.objects.length === 0) add('lifecycle_states.objects', 'Lifecycle-state review must enumerate each consumed stateful object.')
  if (gates.ui_proof?.applies && (gates.ui_proof.assertions.length === 0 || gates.ui_proof.artifacts.length === 0)) add('ui_proof', 'UI proof needs named assertions and private/local artifacts.')

  return violations
}
