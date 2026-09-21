import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import {
  CAPABILITIES,
  PROTECTED_CAPABILITIES,
  normalizeRepositoryIdentity,
  type CandidateIdentity,
} from './yalla-control.js'

const nonEmpty = z.string().trim().min(1)
const dependencySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('semver'), name: nonEmpty, version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/), environment: nonEmpty }),
  z.object({ kind: z.literal('git-revision'), name: nonEmpty, version: z.string().regex(/^[a-f0-9]{40}$/i), environment: nonEmpty }),
  z.object({ kind: z.literal('content-digest'), name: nonEmpty, version: z.string().regex(/^sha256:[a-f0-9]{64}$/i), environment: nonEmpty }),
])

export const releaseAdapterSchema = z.object({
  schema_version: z.literal(1),
  tier: z.enum(['T1', 'T2']),
  project_identity: z.object({
    repository: nonEmpty,
    project_id: nonEmpty,
    team_id: nonEmpty.optional(),
    target: nonEmpty,
  }),
  dependencies: z.array(dependencySchema).default([]),
  commands: z.object({
    preflight: nonEmpty,
    focused_checks: z.array(nonEmpty).min(1),
    full_checks: z.array(nonEmpty).min(1),
    smoke_assertions: z.array(nonEmpty).min(1),
  }),
  protected_capabilities: z.array(z.enum(CAPABILITIES)).default([]).refine(
    capabilities => capabilities.every(capability => PROTECTED_CAPABILITIES.has(capability)),
    'protected_capabilities may contain only protected Yalla capabilities',
  ),
  budgets: z.object({
    max_remote_jobs_per_candidate: z.number().int().positive(),
    max_full_suites_per_candidate: z.number().int().positive(),
    max_production_builds_per_candidate: z.number().int().nonnegative(),
  }),
}).strict()

export type ReleaseAdapter = z.infer<typeof releaseAdapterSchema>

export function loadReleaseAdapter(rootDir: string, adapterPath: string) {
  const path = resolve(rootDir, adapterPath)
  if (!existsSync(path)) return { ok: false as const, path, errors: [`Release adapter not found: ${path}`] }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { ok: false as const, path, errors: [error instanceof Error ? error.message : String(error)] }
  }
  const parsed = releaseAdapterSchema.safeParse(raw)
  if (!parsed.success) return { ok: false as const, path, errors: parsed.error.issues.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`) }
  return { ok: true as const, path, adapter: parsed.data, errors: [] }
}

export function validateAdapterIdentityForCandidate(adapter: ReleaseAdapter, candidate: CandidateIdentity) {
  return normalizeRepositoryIdentity(adapter.project_identity.repository) === normalizeRepositoryIdentity(candidate.repository)
    ? []
    : [`adapter repository ${adapter.project_identity.repository} does not match candidate repository ${candidate.repository}`]
}
