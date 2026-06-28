import { z } from 'zod'

export const sandboxProfileSchema = z.enum(['fast', 'ui-smoke', 'mcp', 'schema', 'money', 'delivery'])
export const sandboxVerdictSchema = z.enum(['PROVEN', 'NOT_PROVEN', 'INCONCLUSIVE'])
export const databaseIsolationSchema = z.enum([
  'not-required',
  'local-supabase',
  'ephemeral-postgres',
  'provider-db-branch',
  'dedicated-test-project',
  'shared-staging',
])

export type SandboxProfile = z.infer<typeof sandboxProfileSchema>

export const sandboxCommandSchema = z.object({
  command: z.string().min(1),
  status: z.enum(['pass', 'fail']),
  exit_code: z.number().int(),
  duration_ms: z.number().int().nonnegative(),
  stdout_ref: z.string().min(1),
  stderr_ref: z.string().min(1),
})

export const sandboxArtifactSchema = z.object({
  kind: z.enum(['log', 'screenshot', 'trace', 'video', 'report', 'other']),
  path: z.string().min(1),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
})

export const sandboxProofSchema = z.object({
  schema_version: z.literal(1),
  issue_id: z.string().regex(/^issue-\d+$/),
  profile: sandboxProfileSchema,
  provider: z.string().min(1),
  sandbox_id: z.string().min(1),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  git: z.object({
    base_sha: z.string().min(1),
    dirty_diff_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    changed_files: z.array(z.string().min(1)).default([]),
  }),
  isolation: z.object({
    workspace: z.enum(['clean-copy', 'remote-clean-copy']),
    app_server: z.enum(['not-required', 'sandbox-owned']),
    database: databaseIsolationSchema,
    network: z.string().min(1),
  }),
  commands: z.array(sandboxCommandSchema).min(1),
  artifacts: z.array(sandboxArtifactSchema).default([]),
  redaction: z.object({
    status: z.enum(['pass', 'fail']),
    patterns_checked: z.array(z.string().min(1)).min(1),
  }),
  teardown: z.object({
    status: z.enum(['pass', 'fail', 'kept-alive']),
    completed_at: z.string().datetime(),
  }),
  verdict: sandboxVerdictSchema,
})

export type SandboxProof = z.infer<typeof sandboxProofSchema>

export type SandboxProofViolation = {
  path: string
  message: string
}

export type SandboxProofValidation = {
  valid: boolean
  verdict: z.infer<typeof sandboxVerdictSchema> | 'INVALID'
  violations: SandboxProofViolation[]
}

const dbRequiredProfiles = new Set<SandboxProfile>(['schema', 'money', 'delivery'])
const highRiskProfiles = new Set<SandboxProfile>(['schema', 'money', 'delivery'])
const likelySecretPattern =
  /(sk_(live|test)_[A-Za-z0-9]{12,}|gh[oprsu]_[A-Za-z0-9_]{12,}|re_[A-Za-z0-9_]{12,}|sbk_[A-Za-z0-9_]{12,}|[A-Z]+_FAKE_SECRET_[A-Za-z0-9_]+|(supabase|stripe|github|vercel|anthropic|openai)[A-Z0-9_ -]{0,20}(secret|token|key)[=: ][A-Za-z0-9._-]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i

function addViolation(violations: SandboxProofViolation[], path: string, message: string) {
  violations.push({ path, message })
}

function isSafeArtifactPath(path: string) {
  return path.startsWith('.pipeline/agent-sandbox-artifacts/') && !path.includes('..') && !path.startsWith('/')
}

export function containsLikelySandboxSecret(value: unknown): boolean {
  if (typeof value === 'string') return likelySecretPattern.test(value)
  if (Array.isArray(value)) return value.some(item => containsLikelySandboxSecret(item))
  if (value && typeof value === 'object') return Object.values(value).some(item => containsLikelySandboxSecret(item))
  return false
}

export function validateSandboxProof(input: unknown): SandboxProofValidation {
  if (containsLikelySandboxSecret(input)) {
    return {
      valid: false,
      verdict: 'INVALID',
      violations: [{ path: '<root>', message: 'Sandbox proof contains a likely secret.' }],
    }
  }

  const parsed = sandboxProofSchema.safeParse(input)
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

  const proof = parsed.data
  const violations: SandboxProofViolation[] = []

  if (proof.verdict === 'PROVEN' && proof.commands.some(command => command.status !== 'pass' || command.exit_code !== 0)) {
    addViolation(violations, 'commands', 'PROVEN requires every command to pass with exit code 0.')
  }

  if (proof.verdict === 'PROVEN' && proof.redaction.status !== 'pass') {
    addViolation(violations, 'redaction.status', 'PROVEN requires redaction to pass.')
  }

  if (proof.verdict === 'PROVEN' && proof.teardown.status === 'fail') {
    addViolation(violations, 'teardown.status', 'PROVEN requires teardown to pass or be explicitly kept alive.')
  }

  if (proof.verdict === 'PROVEN' && dbRequiredProfiles.has(proof.profile)) {
    if (proof.isolation.database === 'not-required' || proof.isolation.database === 'shared-staging') {
      addViolation(violations, 'isolation.database', `${proof.profile} proof requires isolated database evidence.`)
    }
  }

  if (proof.verdict === 'PROVEN' && highRiskProfiles.has(proof.profile) && !proof.provider.startsWith('crabbox')) {
    addViolation(violations, 'provider', 'High-risk PROVEN outcomes require remote sandbox proof.')
  }

  for (const command of proof.commands) {
    if (!isSafeArtifactPath(command.stdout_ref)) {
      addViolation(violations, 'commands.stdout_ref', 'Command artifact refs must stay under .pipeline/agent-sandbox-artifacts/.')
    }
    if (!isSafeArtifactPath(command.stderr_ref)) {
      addViolation(violations, 'commands.stderr_ref', 'Command artifact refs must stay under .pipeline/agent-sandbox-artifacts/.')
    }
  }

  for (const artifact of proof.artifacts) {
    if (!isSafeArtifactPath(artifact.path)) {
      addViolation(violations, 'artifacts.path', 'Artifact paths must stay under .pipeline/agent-sandbox-artifacts/.')
    }
  }

  if (proof.verdict === 'INCONCLUSIVE' && proof.commands.every(command => command.status === 'pass')) {
    addViolation(violations, 'verdict', 'INCONCLUSIVE records are valid only when a provider/risk blocker is represented by failed evidence.')
  }

  return {
    valid: violations.length === 0,
    verdict: violations.length === 0 ? proof.verdict : 'INVALID',
    violations,
  }
}

const sandboxEvidenceRecordSchema = z.object({
  issue_id: z.string().regex(/^issue-\d+$/),
  risk: z.enum(['low', 'medium', 'high', 'critical']),
  outcome_verdict: sandboxVerdictSchema,
  accepted_risk: z.boolean().default(false),
  changed_surfaces: z.array(z.string().min(1)).default([]),
  sandbox_proof: sandboxProofSchema.optional(),
})

export function validateSandboxEvidenceRecord(input: unknown): SandboxProofValidation {
  const parsed = sandboxEvidenceRecordSchema.safeParse(input)
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

  const record = parsed.data
  const violations: SandboxProofViolation[] = []
  const surfaces = record.changed_surfaces.join('\n').toLowerCase()
  const inferredHighRisk =
    record.risk === 'high' ||
    record.risk === 'critical' ||
    /(stripe|checkout|pricing|entitlement|migration|schema|supabase|delivery|artifact|auth|security|token|secret)/.test(surfaces)

  if (record.outcome_verdict === 'PROVEN' && record.accepted_risk && !record.sandbox_proof) {
    addViolation(violations, 'accepted_risk', 'Accepted risk can justify INCONCLUSIVE, not PROVEN without sandbox proof.')
  } else if (record.outcome_verdict === 'PROVEN' && inferredHighRisk && !record.sandbox_proof) {
    addViolation(violations, 'sandbox_proof', 'PROVEN high-risk work requires sandbox proof.')
  }

  if (record.sandbox_proof) {
    const proofValidation = validateSandboxProof(record.sandbox_proof)
    for (const violation of proofValidation.violations) {
      addViolation(violations, `sandbox_proof.${violation.path}`, violation.message)
    }
  }

  return {
    valid: violations.length === 0,
    verdict: violations.length === 0 ? record.outcome_verdict : 'INVALID',
    violations,
  }
}
