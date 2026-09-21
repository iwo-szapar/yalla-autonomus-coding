import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, normalize, relative, resolve, sep } from 'node:path'

export const CONTROL_SCHEMA_VERSION = 2
export const YALLA_CONTROL_VERSION = '1.4.1'

export const CAPABILITIES = [
  'read_repo',
  'write_worktree',
  'manage_worktrees',
  'rewrite_worktree',
  'tracker_write',
  'commit_branch',
  'push_branch',
  'open_pr',
  'merge_pr',
  'deploy_preview',
  'deploy_production',
  'promote_production',
  'configure_provider',
  'manage_secrets',
  'apply_migrations',
  'change_pricing',
  'external_send',
] as const

export type Capability = (typeof CAPABILITIES)[number]

export const PROTECTED_CAPABILITIES = new Set<Capability>([
  'manage_worktrees',
  'rewrite_worktree',
  'merge_pr',
  'deploy_production',
  'promote_production',
  'configure_provider',
  'manage_secrets',
  'apply_migrations',
  'change_pricing',
  'external_send',
])

export const DEFAULT_CAPABILITIES: Capability[] = ['read_repo', 'write_worktree']

export const FAILURE_CLASSES = [
  'CANDIDATE_FAILURE',
  'BASELINE_FAILURE',
  'INFRA_ERROR',
  'IDENTITY_MISMATCH',
  'POLICY_BLOCKED',
  'SUPERSEDED',
] as const

export type FailureClass = (typeof FAILURE_CLASSES)[number]

export type FailureAction =
  | 'repair-candidate'
  | 'separate-baseline-repair'
  | 'retry-same-candidate'
  | 'stop-identity'
  | 'stop-policy'
  | 'discard-superseded'

export type ResumeState =
  | 'RESUMABLE_EXACT'
  | 'RESUMABLE_AFTER_REVALIDATION'
  | 'SUPERSEDED'
  | 'IDENTITY_MISMATCH'
  | 'INCOMPATIBLE_SCHEMA'

export type CandidateIdentity = {
  schema_version: number
  yalla_version: string
  candidate_id: string
  created_at: string
  run_id: string
  issue_id?: string
  repository: string
  declared_repository?: string
  root_dir: string
  pipeline_dir: string
  worktree_path: string
  branch: string
  base_branch: string
  base_sha: string
  head_sha: string
  dirty_fingerprint: string
  contract_digest: string
  config_digest: string
  policy_digest: string
}

export type ArtifactMeta = {
  schema_version: number
  yalla_version: string
  producer: string
  produced_at: string
  candidate_id: string
  candidate_sha: string
  contract_digest: string
  config_digest: string
  policy_digest: string
  input_digests: Record<string, string>
  content_digest: string
  binding_digest: string
}

export type CandidateValidation = {
  state: ResumeState
  reasons: string[]
  current?: CandidateIdentity
}

export type PathClaim = {
  owner: string
  paths: string[]
  changed_paths?: string[]
}

export type OperationReceipt = {
  operation_id: string
  capability: Capability
  action: string
  target: string
  status: 'pending' | 'succeeded' | 'failed'
  candidate_id: string
  candidate_sha: string
  pipeline_dir: string
  approval_reference?: string
  execution_authority: 'local-configured-capability' | 'none-local-telemetry-only'
  recorded_at: string
  completed_at?: string
}

export type RemoteJob = {
  operation_id: string
  kind: 'focused-check' | 'full-suite' | 'preview-build' | 'production-build' | 'smoke'
  artifact_action: 'built' | 'reused'
  status: 'pending' | 'succeeded' | 'failed' | 'blocked'
  duration_seconds: number
  cost?: number
  retry_reason?: string
  candidate_id: string
  candidate_sha: string
  pipeline_dir: string
  recorded_at: string
  completed_at?: string
  execution_authority: 'none-local-telemetry-only'
}

type CandidateOptions = {
  rootDir: string
  pipelineDir?: string
  repository?: string
  baseBranch?: string
  runId?: string
  issueId?: string
  configPath?: string
  releaseAdapterPath?: string
  now?: () => string
}

type RunLock = {
  path: string
  token: string
  owner: string
}

const TRUST_ROOTS = ['AGENTS.md', 'CLAUDE.md', '.claude/YALLA.md', 'skills', 'agents', 'hooks']

export function hashValue(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export function digestFile(path: string) {
  if (!existsSync(path) || statSync(path).isDirectory()) return hashValue(null)
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function atomicWriteJson(path: string, value: unknown) {
  atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function atomicWriteText(path: string, value: string) {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tempPath, value, { mode: 0o600 })
  renameSync(tempPath, path)
}

export function resolvePipelineStateDir(rootDir: string, requested = '.pipeline'): { absolute: string; relative: string } {
  const root = realpathOrResolved(rootDir)
  const requestedValue = String(requested ?? '')
  const raw = requestedValue.trim()
  if (!raw) throw new Error('Pipeline directory must be a non-empty repository-contained path.')
  if (raw !== requestedValue || raw.endsWith('/')) throw new Error(`Pipeline directory must be canonical and cannot contain aliases: ${requested}`)
  if (raw.includes('\\')) throw new Error(`Pipeline directory must use canonical path separators: ${requested}`)

  const normalizedRequest = normalize(raw)
  if (normalizedRequest !== raw) throw new Error(`Pipeline directory must be canonical and cannot contain aliases: ${requested}`)

  const lexicalRoot = resolve(rootDir)
  const lexicalAbsolute = isAbsolute(raw) ? resolve(raw) : resolve(lexicalRoot, raw)
  const lexicalRelative = relative(lexicalRoot, lexicalAbsolute)
  const requestedThroughRootAlias = lexicalRelative && lexicalRelative !== '..' && !lexicalRelative.startsWith(`..${sep}`) && !isAbsolute(lexicalRelative)
  const absolute = (requestedThroughRootAlias ? resolve(root, lexicalRelative) : lexicalAbsolute).replaceAll(sep, '/')
  const relativePath = relative(root, absolute).replaceAll('\\', '/')
  if (!relativePath || relativePath === '.' || relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)) {
    throw new Error(`Pipeline directory must stay inside the repository: ${requested}`)
  }
  if (relativePath !== '.pipeline' && !/^\.pipeline\/runs\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(relativePath)) {
    throw new Error(`Pipeline directory must be .pipeline for legacy reads or a canonical .pipeline/runs/<issue-id>/<run-id> namespace: ${requested}`)
  }

  let cursor = root
  for (const segment of relativePath.split('/')) {
    cursor = resolve(cursor, segment)
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Pipeline directory cannot traverse a symbolic link: ${requested}`)
    }
  }
  if (existsSync(absolute) && !statSync(absolute).isDirectory()) {
    throw new Error(`Pipeline directory must resolve to a directory: ${requested}`)
  }
  return { absolute, relative: relativePath }
}

export function canonicalPipelineStateDir(issueId: string | undefined, runId: string | undefined) {
  const issue = String(issueId ?? '').trim()
  const run = String(runId ?? '').trim()
  const component = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
  if (!component.test(issue) || !component.test(run)) throw new Error('Stable issue and run IDs must be canonical path components containing only letters, numbers, dot, underscore, or dash.')
  return `.pipeline/runs/${issue}/${run}`
}

export function acquireRunLock(rootDir: string, owner: string, now: () => string = () => new Date().toISOString(), pipelineDir?: string): RunLock {
  const stateDir = resolveWritablePipelineStateDir(rootDir, pipelineDir)
  mkdirSync(stateDir.absolute, { recursive: true })
  const path = resolve(stateDir.absolute, 'run.lock')
  const token = randomUUID()
  let descriptor: number
  try {
    descriptor = openSync(path, 'wx', 0o600)
  } catch (error) {
    const current = safeReadJson(path)
    const lockOwner = typeof current?.owner === 'string' ? current.owner : 'unknown'
    throw new Error(`Yalla run lock is already held by ${lockOwner}; refusing concurrent state mutation.`)
  }
  try {
    writeFileSync(descriptor, `${JSON.stringify({ schema_version: CONTROL_SCHEMA_VERSION, token, owner, pid: process.pid, acquired_at: now() }, null, 2)}\n`)
  } finally {
    closeSync(descriptor)
  }
  return { path, token, owner }
}

export function releaseRunLock(lock: RunLock) {
  const current = safeReadJson(lock.path)
  if (current?.token !== lock.token) throw new Error(`Yalla run lock token changed for ${lock.owner}; refusing to remove another writer's lock.`)
  rmSync(lock.path)
}

export async function withRunLock<T>(rootDir: string, owner: string, action: () => Promise<T> | T, pipelineDir: string): Promise<T> {
  const lock = acquireRunLock(rootDir, owner, undefined, pipelineDir)
  try {
    return await action()
  } finally {
    releaseRunLock(lock)
  }
}

export function createCandidateIdentity(options: CandidateOptions): CandidateIdentity {
  const now = options.now ?? (() => new Date().toISOString())
  const rootDir = realpathOrResolved(options.rootDir)
  const expectedPipelineDir = canonicalPipelineStateDir(options.issueId, options.runId)
  const pipelineDir = resolvePipelineStateDir(rootDir, options.pipelineDir ?? expectedPipelineDir)
  if (pipelineDir.relative !== expectedPipelineDir) throw new Error(`Candidate issue/run identity requires pipeline directory ${expectedPipelineDir}, not ${pipelineDir.relative}.`)
  const git = inspectGit(rootDir, options.baseBranch ?? 'main', pipelineDir.relative)
  const contractDigest = digestFile(resolve(pipelineDir.absolute, 'goal-contract.json'))
  const configPath = options.configPath ? resolve(rootDir, options.configPath) : resolve(rootDir, '.claude/YALLA.md')
  const configDigest = digestFile(configPath)
  const policyDigest = digestPolicy(rootDir, options.releaseAdapterPath)
  const declaredRepository = options.repository ? normalizeRepositoryIdentity(options.repository) : undefined
  const observedRepository = normalizeRepositoryIdentity(git.repository)
  if (declaredRepository && declaredRepository !== observedRepository) {
    throw new Error(`Declared repository ${declaredRepository} does not match observed origin ${observedRepository}.`)
  }
  const identity = {
    schema_version: CONTROL_SCHEMA_VERSION,
    yalla_version: YALLA_CONTROL_VERSION,
    created_at: now(),
    run_id: options.runId || randomUUID(),
    issue_id: options.issueId,
    repository: observedRepository,
    declared_repository: declaredRepository,
    root_dir: rootDir,
    pipeline_dir: pipelineDir.relative,
    worktree_path: git.worktreePath,
    branch: git.branch,
    base_branch: options.baseBranch ?? 'main',
    base_sha: git.baseSha,
    head_sha: git.headSha,
    dirty_fingerprint: git.dirtyFingerprint,
    contract_digest: contractDigest,
    config_digest: configDigest,
    policy_digest: policyDigest,
  }
  return { ...identity, candidate_id: hashValue(candidateAddress(identity)) }
}

export function validateCandidate(candidate: CandidateIdentity, options: Omit<CandidateOptions, 'runId' | 'issueId' | 'now'>): CandidateValidation {
  const requiredStrings: Array<keyof CandidateIdentity> = [
    'yalla_version', 'candidate_id', 'created_at', 'run_id', 'repository', 'root_dir', 'worktree_path', 'branch',
    'pipeline_dir', 'base_branch', 'base_sha', 'head_sha', 'dirty_fingerprint', 'contract_digest', 'config_digest', 'policy_digest',
  ]
  if (!candidate || typeof candidate !== 'object' || requiredStrings.some(field => typeof candidate[field] !== 'string' || !String(candidate[field]).trim())) {
    return { state: 'INCOMPATIBLE_SCHEMA', reasons: ['candidate is missing required identity fields'] }
  }
  if (candidate.schema_version !== CONTROL_SCHEMA_VERSION) {
    return { state: 'INCOMPATIBLE_SCHEMA', reasons: [`candidate schema ${candidate.schema_version} is not supported by schema ${CONTROL_SCHEMA_VERSION}`] }
  }
  if (candidate.yalla_version !== YALLA_CONTROL_VERSION) {
    return { state: 'INCOMPATIBLE_SCHEMA', reasons: [`candidate Yalla version ${candidate.yalla_version} is not supported by ${YALLA_CONTROL_VERSION}`] }
  }
  if (candidate.candidate_id !== hashValue(candidateAddress(candidate))) {
    return { state: 'IDENTITY_MISMATCH', reasons: ['candidate address does not match its immutable fields'] }
  }

  let current: CandidateIdentity
  try {
    current = createCandidateIdentity({
      ...options,
      runId: candidate.run_id,
      issueId: candidate.issue_id,
      repository: options.repository ?? candidate.declared_repository,
      baseBranch: options.baseBranch ?? candidate.base_branch,
      pipelineDir: candidate.pipeline_dir,
      now: () => candidate.created_at,
    })
  } catch (error) {
    return { state: 'IDENTITY_MISMATCH', reasons: [error instanceof Error ? error.message : String(error)] }
  }

  const identityReasons: string[] = []
  if (candidate.root_dir !== current.root_dir) identityReasons.push(`root directory changed from ${candidate.root_dir} to ${current.root_dir}`)
  if (candidate.pipeline_dir !== current.pipeline_dir) identityReasons.push(`pipeline directory changed from ${candidate.pipeline_dir} to ${current.pipeline_dir}`)
  if (candidate.repository !== current.repository) identityReasons.push(`repository changed from ${candidate.repository} to ${current.repository}`)
  if (candidate.declared_repository !== current.declared_repository) identityReasons.push(`declared repository changed from ${candidate.declared_repository ?? '<auto>'} to ${current.declared_repository ?? '<auto>'}`)
  if (candidate.worktree_path !== current.worktree_path) identityReasons.push(`worktree changed from ${candidate.worktree_path} to ${current.worktree_path}`)
  if (candidate.branch !== current.branch) identityReasons.push(`branch changed from ${candidate.branch} to ${current.branch}`)
  if (candidate.base_branch !== current.base_branch) identityReasons.push(`base branch changed from ${candidate.base_branch} to ${current.base_branch}`)
  if (identityReasons.length) return { state: 'IDENTITY_MISMATCH', reasons: identityReasons, current }

  const supersededReasons: string[] = []
  if (candidate.head_sha !== current.head_sha) supersededReasons.push(`HEAD changed from ${candidate.head_sha} to ${current.head_sha}`)
  if (candidate.base_sha !== current.base_sha) supersededReasons.push(`base SHA changed from ${candidate.base_sha} to ${current.base_sha}`)
  if (supersededReasons.length) return { state: 'SUPERSEDED', reasons: supersededReasons, current }

  const revalidationReasons: string[] = []
  if (candidate.dirty_fingerprint !== current.dirty_fingerprint) revalidationReasons.push('working-tree fingerprint changed')
  if (candidate.contract_digest !== current.contract_digest) revalidationReasons.push('goal contract changed')
  if (candidate.config_digest !== current.config_digest) revalidationReasons.push('Yalla configuration changed')
  if (candidate.policy_digest !== current.policy_digest) revalidationReasons.push('trust-root policy changed')
  if (revalidationReasons.length) return { state: 'RESUMABLE_AFTER_REVALIDATION', reasons: revalidationReasons, current }

  return { state: 'RESUMABLE_EXACT', reasons: [], current }
}

export function createArtifactMeta(candidate: CandidateIdentity, producer: string, inputPaths: string[] = [], content: unknown = {}, now: () => string = () => new Date().toISOString()): ArtifactMeta {
  const inputDigests = Object.fromEntries(inputPaths.map(path => [path, digestFile(resolve(candidate.root_dir, path))]))
  const meta = {
    schema_version: CONTROL_SCHEMA_VERSION,
    yalla_version: YALLA_CONTROL_VERSION,
    producer,
    produced_at: now(),
    candidate_id: candidate.candidate_id,
    candidate_sha: candidate.head_sha,
    contract_digest: candidate.contract_digest,
    config_digest: candidate.config_digest,
    policy_digest: candidate.policy_digest,
    input_digests: inputDigests,
    content_digest: hashValue(content),
  }
  return { ...meta, binding_digest: hashValue({ content, meta }) }
}

export function bindArtifact<T extends Record<string, unknown>>(
  document: T,
  candidate: CandidateIdentity,
  producer: string,
  inputPaths: string[] = [],
  now: () => string = () => new Date().toISOString(),
): T & { _meta: ArtifactMeta } {
  const content = JSON.parse(JSON.stringify({ ...document })) as T
  delete content._meta
  return { ...content, _meta: createArtifactMeta(candidate, producer, inputPaths, content, now) }
}

export function artifactFreshness(document: Record<string, unknown> | null, candidate: CandidateIdentity | null) {
  if (!candidate) return { status: 'UNBOUND' as const, reason: 'no active candidate' }
  const meta = document?._meta as Partial<ArtifactMeta> | undefined
  if (!meta) return { status: 'UNBOUND' as const, reason: 'artifact has no candidate metadata' }
  if (meta.schema_version !== CONTROL_SCHEMA_VERSION) return { status: 'INCOMPATIBLE' as const, reason: `artifact schema ${String(meta.schema_version)} is unsupported` }
  if (meta.candidate_id !== candidate.candidate_id || meta.candidate_sha !== candidate.head_sha) return { status: 'STALE' as const, reason: 'artifact belongs to another candidate' }
  if (meta.contract_digest !== candidate.contract_digest || meta.config_digest !== candidate.config_digest || meta.policy_digest !== candidate.policy_digest) {
    return { status: 'STALE' as const, reason: 'artifact inputs no longer match the candidate' }
  }
  if (!meta.content_digest || !meta.binding_digest || !meta.input_digests || typeof meta.input_digests !== 'object' || Array.isArray(meta.input_digests)) {
    return { status: 'INCOMPATIBLE' as const, reason: 'artifact has incomplete immutable binding metadata' }
  }
  const content = { ...document }
  delete content._meta
  if (hashValue(content) !== meta.content_digest) return { status: 'STALE' as const, reason: 'artifact content changed after binding' }
  const boundMeta = { ...meta } as Record<string, unknown>
  delete boundMeta.binding_digest
  if (hashValue({ content, meta: boundMeta }) !== meta.binding_digest) return { status: 'STALE' as const, reason: 'artifact binding metadata changed after binding' }
  for (const [inputPath, expectedDigest] of Object.entries(meta.input_digests)) {
    const absolutePath = resolve(candidate.root_dir, inputPath)
    const relativePath = relative(candidate.root_dir, absolutePath)
    if (relativePath.startsWith('..') || relativePath === '..') {
      return { status: 'STALE' as const, reason: `artifact input escapes the candidate worktree: ${inputPath}` }
    }
    if (digestFile(absolutePath) !== expectedDigest) {
      return { status: 'STALE' as const, reason: `artifact input changed: ${inputPath}` }
    }
  }
  return { status: 'CURRENT' as const, reason: '' }
}

export function routeFailure(failureClass: FailureClass): FailureAction {
  if (failureClass === 'CANDIDATE_FAILURE') return 'repair-candidate'
  if (failureClass === 'BASELINE_FAILURE') return 'separate-baseline-repair'
  if (failureClass === 'INFRA_ERROR') return 'retry-same-candidate'
  if (failureClass === 'IDENTITY_MISMATCH') return 'stop-identity'
  if (failureClass === 'POLICY_BLOCKED') return 'stop-policy'
  return 'discard-superseded'
}

export function normalizeFailureClass(value: string | undefined): FailureClass | undefined {
  const normalized = String(value ?? '').trim().toUpperCase()
  return FAILURE_CLASSES.find(failureClass => failureClass === normalized)
}

export function isCapability(value: string): value is Capability {
  return CAPABILITIES.includes(value as Capability)
}

export function requireCapability(allowed: Capability[], capability: Capability) {
  if (!allowed.includes(capability)) throw new Error(`Capability ${capability} is not granted for this run.`)
}

export function requiredCapabilityForCommand(command: string, args: string[]): Capability | undefined {
  const [verb, subverb] = args
  if (command === 'git' && verb === 'commit') return 'commit_branch'
  if (command === 'git' && verb === 'push') return 'push_branch'
  if (command === 'git' && verb === 'worktree') return 'manage_worktrees'
  if (command === 'git' && ['reset', 'clean', 'checkout', 'switch'].includes(String(verb))) return 'rewrite_worktree'
  if (command === 'gh' && verb === 'issue' && ['create', 'edit', 'comment', 'close', 'reopen'].includes(String(subverb))) return 'tracker_write'
  if (command === 'gh' && verb === 'pr' && subverb === 'create') return 'open_pr'
  if (command === 'gh' && verb === 'pr' && subverb === 'merge') return 'merge_pr'
  if (command === 'gh' && verb === 'pr' && ['edit', 'comment', 'close', 'reopen'].includes(String(subverb))) return 'tracker_write'
  if (command === 'gh' && verb === 'secret' && ['set', 'delete'].includes(String(subverb))) return 'manage_secrets'
  if (command === 'vercel' && verb === 'promote') return 'promote_production'
  if (command === 'vercel' && ['link', 'project', 'projects'].includes(String(verb))) return 'configure_provider'
  if (command === 'vercel' && verb === 'env' && ['add', 'rm', 'remove'].includes(String(subverb))) return 'manage_secrets'
  if (command === 'vercel' && args.includes('--prod')) return 'deploy_production'
  if (command === 'vercel' && verb === 'deploy') return 'deploy_preview'
  if (command === 'supabase' && verb === 'db' && ['push', 'reset'].includes(String(subverb))) return 'apply_migrations'
  if (command === 'supabase' && verb === 'secrets' && ['set', 'unset'].includes(String(subverb))) return 'manage_secrets'
  return undefined
}

export function recordOperationReceipt(input: {
  rootDir: string
  pipelineDir?: string
  candidate: CandidateIdentity
  allowedCapabilities: Capability[]
  operationId: string
  capability: Capability
  action: string
  target: string
  operationStatus?: OperationReceipt['status']
  now?: () => string
}): { status: 'recorded' | 'duplicate' | 'updated'; receipt: OperationReceipt } {
  const now = input.now ?? (() => new Date().toISOString())
  const nowValue = now()
  const operationStatus = input.operationStatus ?? 'pending'
  if (PROTECTED_CAPABILITIES.has(input.capability)) {
    throw new Error(`Protected capability ${input.capability} cannot be authorized by the local Yalla runner; use an external operator-controlled executor.`)
  }
  const stateDir = resolveCandidatePipelineStateDir(input.rootDir, input.candidate, input.pipelineDir)
  const path = resolve(stateDir.absolute, 'operation-receipts.json')
  const document = safeReadJson(path)
  assertStateDocumentNamespace(document, stateDir.relative, path)
  const receipts = Array.isArray(document?.receipts) ? document.receipts as OperationReceipt[] : []
  if (receipts.some(receipt => receipt.pipeline_dir !== stateDir.relative)) throw new Error(`Operation receipts in ${path} contain mismatched pipeline directory metadata.`)
  const existing = receipts.find(receipt => receipt.operation_id === input.operationId)
  if (existing) {
    if (existing.pipeline_dir !== stateDir.relative) throw new Error(`Operation ${input.operationId} is bound to pipeline directory ${existing.pipeline_dir}.`)
    if (existing.execution_authority !== 'local-configured-capability') throw new Error(`Operation ${input.operationId} has incompatible or non-local authority metadata.`)
    if (existing.capability !== input.capability || existing.action !== input.action || existing.target !== input.target || existing.candidate_id !== input.candidate.candidate_id) {
      throw new Error(`Operation ID ${input.operationId} already belongs to a different action or candidate.`)
    }
    if (operationStatus === 'pending' || existing.status === operationStatus) return { status: 'duplicate', receipt: existing }
    if (existing.status !== 'pending') throw new Error(`Operation ${input.operationId} is already terminal with status ${existing.status}.`)
    const updated: OperationReceipt = { ...existing, status: operationStatus, completed_at: nowValue }
    atomicWriteJson(path, { schema_version: CONTROL_SCHEMA_VERSION, yalla_version: YALLA_CONTROL_VERSION, pipeline_dir: stateDir.relative, receipts: receipts.map(receipt => receipt.operation_id === input.operationId ? updated : receipt) })
    return { status: 'updated', receipt: updated }
  }
  if (operationStatus !== 'pending') throw new Error(`Operation ${input.operationId} must be reserved as pending before it can become ${operationStatus}.`)
  requireCapability(input.allowedCapabilities, input.capability)
  const receipt: OperationReceipt = {
    operation_id: input.operationId,
    capability: input.capability,
    action: input.action,
    target: input.target,
    status: 'pending',
    candidate_id: input.candidate.candidate_id,
    candidate_sha: input.candidate.head_sha,
    pipeline_dir: stateDir.relative,
    execution_authority: 'local-configured-capability',
    recorded_at: nowValue,
  }
  atomicWriteJson(path, { schema_version: CONTROL_SCHEMA_VERSION, yalla_version: YALLA_CONTROL_VERSION, pipeline_dir: stateDir.relative, receipts: [...receipts, receipt] })
  return { status: 'recorded', receipt }
}

export function completeOperationReceipt(input: {
  rootDir: string
  pipelineDir?: string
  operationId: string
  capability: Capability
  action: string
  target: string
  status: 'succeeded' | 'failed'
  now?: () => string
}) {
  const stateDir = resolveWritablePipelineStateDir(input.rootDir, input.pipelineDir)
  const path = resolve(stateDir.absolute, 'operation-receipts.json')
  const document = safeReadJson(path)
  assertStateDocumentNamespace(document, stateDir.relative, path)
  const receipts = Array.isArray(document?.receipts) ? document.receipts as OperationReceipt[] : []
  if (receipts.some(receipt => receipt.pipeline_dir !== stateDir.relative)) throw new Error(`Operation receipts in ${path} contain mismatched pipeline directory metadata.`)
  const existing = receipts.find(receipt => receipt.operation_id === input.operationId)
  if (!existing) throw new Error(`Operation ${input.operationId} must be reserved before it can become ${input.status}.`)
  if (existing.pipeline_dir !== stateDir.relative) throw new Error(`Operation ${input.operationId} is bound to pipeline directory ${existing.pipeline_dir}.`)
  if (existing.capability !== input.capability || existing.action !== input.action || existing.target !== input.target) throw new Error(`Operation ID ${input.operationId} belongs to a different action or target.`)
  const expectedAuthority = PROTECTED_CAPABILITIES.has(existing.capability) ? 'none-local-telemetry-only' : 'local-configured-capability'
  if (existing.execution_authority !== expectedAuthority) throw new Error(`Operation ${input.operationId} cannot be completed: expected execution_authority ${expectedAuthority}.`)
  if (existing.status === input.status) return { status: 'duplicate' as const, receipt: existing }
  if (existing.status !== 'pending') throw new Error(`Operation ${input.operationId} is already terminal with status ${existing.status}.`)
  const updated: OperationReceipt = { ...existing, status: input.status, completed_at: (input.now ?? (() => new Date().toISOString()))() }
  atomicWriteJson(path, { schema_version: CONTROL_SCHEMA_VERSION, yalla_version: YALLA_CONTROL_VERSION, pipeline_dir: stateDir.relative, receipts: receipts.map(receipt => receipt.operation_id === input.operationId ? updated : receipt) })
  return { status: 'updated' as const, receipt: updated }
}

export function recordRemoteJob(input: {
  rootDir: string
  pipelineDir?: string
  candidate: CandidateIdentity
  operationId: string
  kind: RemoteJob['kind']
  artifactAction: RemoteJob['artifact_action']
  status: RemoteJob['status']
  durationSeconds: number
  cost?: number
  retryReason?: string
  now?: () => string
}): { status: 'recorded' | 'duplicate' | 'updated'; job: RemoteJob } {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 0) throw new Error('Remote job duration must be a non-negative finite number.')
  if (input.cost !== undefined && (!Number.isFinite(input.cost) || input.cost < 0)) throw new Error('Remote job cost must be a non-negative finite number when provided.')
  const stateDir = resolveCandidatePipelineStateDir(input.rootDir, input.candidate, input.pipelineDir)
  const path = resolve(stateDir.absolute, 'remote-jobs.json')
  const document = safeReadJson(path)
  assertStateDocumentNamespace(document, stateDir.relative, path)
  const jobs = Array.isArray(document?.jobs) ? document.jobs as RemoteJob[] : []
  if (jobs.some(job => job.pipeline_dir !== stateDir.relative)) throw new Error(`Remote jobs in ${path} contain mismatched pipeline directory metadata.`)
  const existing = jobs.find(job => job.operation_id === input.operationId)
  if (existing) {
    if (existing.pipeline_dir !== stateDir.relative) throw new Error(`Remote job ${input.operationId} is bound to pipeline directory ${existing.pipeline_dir}.`)
    if (existing.execution_authority !== 'none-local-telemetry-only') throw new Error(`Remote job ${input.operationId} has incompatible authority metadata.`)
    if (existing.candidate_id !== input.candidate.candidate_id || existing.kind !== input.kind || existing.artifact_action !== input.artifactAction) {
      throw new Error(`Remote job ID ${input.operationId} already belongs to a different job or candidate.`)
    }
    if (input.status === 'pending' || existing.status === input.status) return { status: 'duplicate', job: existing }
    if (existing.status !== 'pending' || !['succeeded', 'failed'].includes(input.status)) {
      throw new Error(`Remote job ${input.operationId} cannot move from ${existing.status} to ${input.status}.`)
    }
    const updated: RemoteJob = {
      ...existing,
      status: input.status,
      duration_seconds: input.durationSeconds,
      cost: input.cost,
      retry_reason: input.retryReason,
      completed_at: (input.now ?? (() => new Date().toISOString()))(),
    }
    writeRemoteJobs(path, stateDir.relative, input.candidate.candidate_id, jobs.map(job => job.operation_id === input.operationId ? updated : job))
    return { status: 'updated', job: updated }
  }
  if (!['pending', 'blocked'].includes(input.status)) throw new Error(`Remote job ${input.operationId} must be reserved before it can become ${input.status}.`)
  const job: RemoteJob = {
    operation_id: input.operationId,
    kind: input.kind,
    artifact_action: input.artifactAction,
    status: input.status,
    duration_seconds: input.durationSeconds,
    cost: input.cost,
    retry_reason: input.retryReason,
    candidate_id: input.candidate.candidate_id,
    candidate_sha: input.candidate.head_sha,
    pipeline_dir: stateDir.relative,
    recorded_at: (input.now ?? (() => new Date().toISOString()))(),
    execution_authority: 'none-local-telemetry-only',
  }
  const nextJobs = [...jobs, job]
  writeRemoteJobs(path, stateDir.relative, input.candidate.candidate_id, nextJobs)
  return { status: 'recorded', job }
}

export function completeRemoteJob(input: {
  rootDir: string
  pipelineDir?: string
  operationId: string
  kind: RemoteJob['kind']
  artifactAction: RemoteJob['artifact_action']
  status: 'succeeded' | 'failed'
  durationSeconds: number
  cost?: number
  retryReason?: string
  now?: () => string
}) {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 0) throw new Error('Remote job duration must be a non-negative finite number.')
  if (input.cost !== undefined && (!Number.isFinite(input.cost) || input.cost < 0)) throw new Error('Remote job cost must be a non-negative finite number when provided.')
  const stateDir = resolveWritablePipelineStateDir(input.rootDir, input.pipelineDir)
  const path = resolve(stateDir.absolute, 'remote-jobs.json')
  const document = safeReadJson(path)
  assertStateDocumentNamespace(document, stateDir.relative, path)
  const jobs = Array.isArray(document?.jobs) ? document.jobs as RemoteJob[] : []
  if (jobs.some(job => job.pipeline_dir !== stateDir.relative)) throw new Error(`Remote jobs in ${path} contain mismatched pipeline directory metadata.`)
  const existing = jobs.find(job => job.operation_id === input.operationId)
  if (!existing) throw new Error(`Remote job ${input.operationId} must be reserved before it can become ${input.status}.`)
  if (existing.pipeline_dir !== stateDir.relative) throw new Error(`Remote job ${input.operationId} is bound to pipeline directory ${existing.pipeline_dir}.`)
  if (existing.execution_authority !== 'none-local-telemetry-only') throw new Error(`Remote job ${input.operationId} cannot be completed without execution_authority none-local-telemetry-only.`)
  if (existing.kind !== input.kind || existing.artifact_action !== input.artifactAction) throw new Error(`Remote job ID ${input.operationId} belongs to a different job.`)
  if (existing.status === input.status) return { status: 'duplicate' as const, job: existing }
  if (existing.status !== 'pending') throw new Error(`Remote job ${input.operationId} cannot move from ${existing.status} to ${input.status}.`)
  const updated: RemoteJob = { ...existing, status: input.status, duration_seconds: input.durationSeconds, cost: input.cost, retry_reason: input.retryReason, completed_at: (input.now ?? (() => new Date().toISOString()))() }
  writeRemoteJobs(path, stateDir.relative, existing.candidate_id, jobs.map(job => job.operation_id === input.operationId ? updated : job))
  return { status: 'updated' as const, job: updated }
}

function writeRemoteJobs(path: string, pipelineDir: string, candidateId: string, jobs: RemoteJob[]) {
  const candidateJobs = jobs.filter(item => item.candidate_id === candidateId)
  const consumedJobs = candidateJobs.filter(item => item.status !== 'blocked')
  atomicWriteJson(path, {
    schema_version: CONTROL_SCHEMA_VERSION,
    yalla_version: YALLA_CONTROL_VERSION,
    pipeline_dir: pipelineDir,
    candidate_id: candidateId,
    jobs,
    summary: {
      attempts: candidateJobs.length,
      remote_jobs: consumedJobs.length,
      pending: candidateJobs.filter(item => item.status === 'pending').length,
      succeeded: candidateJobs.filter(item => item.status === 'succeeded').length,
      failed: candidateJobs.filter(item => item.status === 'failed').length,
      blocked: candidateJobs.filter(item => item.status === 'blocked').length,
      builds: consumedJobs.filter(item => item.artifact_action === 'built').length,
      artifact_reuses: consumedJobs.filter(item => item.artifact_action === 'reused').length,
      duration_seconds: candidateJobs.reduce((total, item) => total + item.duration_seconds, 0),
      known_cost: candidateJobs.reduce((total, item) => total + (item.cost ?? 0), 0),
    },
  })
}

export function checkRemoteJobBudget(input: {
  rootDir: string
  pipelineDir?: string
  candidate: CandidateIdentity
  operationId: string
  kind: RemoteJob['kind']
  artifactAction: RemoteJob['artifact_action']
  budgets: {
    max_remote_jobs_per_candidate: number
    max_full_suites_per_candidate: number
    max_production_builds_per_candidate: number
  }
}) {
  const stateDir = resolveCandidatePipelineStateDir(input.rootDir, input.candidate, input.pipelineDir)
  const path = resolve(stateDir.absolute, 'remote-jobs.json')
  const document = safeReadJson(path)
  assertStateDocumentNamespace(document, stateDir.relative, path)
  const jobs = Array.isArray(document?.jobs) ? document.jobs as RemoteJob[] : []
  if (jobs.some(job => job.pipeline_dir !== stateDir.relative)) throw new Error(`Remote jobs in ${path} contain mismatched pipeline directory metadata.`)
  const existing = jobs.find(job => job.operation_id === input.operationId)
  if (existing?.status === 'blocked') return { allowed: false as const, duplicate: true, reason: existing.retry_reason || 'remote job reservation was blocked' }
  if (existing) return { allowed: true as const, duplicate: true, reason: '' }
  const candidateJobs = jobs.filter(job => job.candidate_id === input.candidate.candidate_id && job.status !== 'blocked')
  if (candidateJobs.length >= input.budgets.max_remote_jobs_per_candidate) {
    return { allowed: false as const, duplicate: false, reason: `remote job budget exhausted (${input.budgets.max_remote_jobs_per_candidate})` }
  }
  if (input.artifactAction === 'built' && input.kind === 'full-suite' && candidateJobs.filter(job => job.kind === 'full-suite' && job.artifact_action === 'built').length >= input.budgets.max_full_suites_per_candidate) {
    return { allowed: false as const, duplicate: false, reason: `full-suite budget exhausted (${input.budgets.max_full_suites_per_candidate})` }
  }
  if (input.artifactAction === 'built' && input.kind === 'production-build' && candidateJobs.filter(job => job.kind === 'production-build' && job.artifact_action === 'built').length >= input.budgets.max_production_builds_per_candidate) {
    return { allowed: false as const, duplicate: false, reason: `production-build budget exhausted (${input.budgets.max_production_builds_per_candidate})` }
  }
  return { allowed: true as const, duplicate: false, reason: '' }
}

export function detectPathOverlaps(claims: PathClaim[]) {
  const overlaps: Array<{ owners: [string, string]; paths: [string, string] }> = []
  for (let leftIndex = 0; leftIndex < claims.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex++) {
      const left = claims[leftIndex]
      const right = claims[rightIndex]
      if (left.owner === right.owner) continue
      for (const leftPath of left.paths) {
        for (const rightPath of right.paths) {
          if (pathsOverlap(leftPath, rightPath)) overlaps.push({ owners: [left.owner, right.owner], paths: [leftPath, rightPath] })
        }
      }
    }
  }
  return overlaps
}

export function normalizePathClaims(rootDir: string, claims: PathClaim[]): PathClaim[] {
  return claims.map(claim => {
    const paths = claim.paths.map(path => normalizeClaimPath(rootDir, path))
    const changedPaths = claim.changed_paths?.map(path => normalizeClaimPath(rootDir, path))
    const outsideOwnerPaths = changedPaths?.filter(path => !paths.some(claimedPath => pathsOverlap(path, claimedPath))) ?? []
    if (outsideOwnerPaths.length) throw new Error(`Owner ${claim.owner} attributed changes outside its declared paths: ${outsideOwnerPaths.join(', ')}`)
    return { owner: claim.owner.trim(), paths, changed_paths: changedPaths }
  })
}

export function validatePathAttribution(changedPaths: string[], claims: PathClaim[]) {
  if (claims.length <= 1) return { unattributed: [] as string[], falsely_claimed: [] as string[], multiply_attributed: [] as string[] }
  if (claims.some(claim => !Array.isArray(claim.changed_paths))) throw new Error('Parallel ownership requires changed_paths[] evidence for every owner.')
  const attributions = claims.flatMap(claim => (claim.changed_paths ?? []).map(path => ({ owner: claim.owner, path })))
  return {
    unattributed: changedPaths.filter(path => !attributions.some(item => item.path === path)),
    falsely_claimed: attributions.filter(item => !changedPaths.includes(item.path)).map(item => `${item.owner}:${item.path}`),
    multiply_attributed: changedPaths.filter(path => new Set(attributions.filter(item => item.path === path).map(item => item.owner)).size > 1),
  }
}

export function listMaterialChangedPaths(rootDir: string) {
  const run = (args: string[]) => execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const tracked = run(['diff', '--name-only', '-z', 'HEAD', '--', '.', ':(exclude).pipeline/**', ':(exclude).pipeline-state.json']).split('\0').filter(Boolean)
  const untracked = run(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
  return [...new Set([...tracked, ...untracked])]
    .map(path => path.replaceAll('\\', '/'))
    .filter(path => path !== '.pipeline-state.json' && !path.startsWith('.pipeline/'))
    .sort()
}

export function findUnownedChangedPaths(changedPaths: string[], claims: PathClaim[]) {
  return changedPaths.filter(changedPath => !claims.some(claim => claim.paths.some(claimedPath => pathsOverlap(changedPath, claimedPath))))
}

function normalizeClaimPath(rootDir: string, rawPath: string) {
  const requested = String(rawPath ?? '').trim().replaceAll('\\', '/').replace(/\/$/, '')
  if (!requested || isAbsolute(requested) || requested === '..' || requested.startsWith('../')) throw new Error(`Path claim must stay repository-relative: ${rawPath}`)
  const normalized = normalize(requested).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (!normalized || normalized === '.' || normalized !== requested.replace(/^\.\//, '')) throw new Error(`Path claim must be canonical and cannot contain aliases: ${rawPath}`)
  const absolutePath = resolve(rootDir, normalized)
  const relativePath = relative(rootDir, absolutePath).replaceAll('\\', '/')
  if (relativePath === '..' || relativePath.startsWith('../')) throw new Error(`Path claim escapes the repository: ${rawPath}`)
  let cursor = realpathOrResolved(rootDir)
  for (const segment of normalized.split('/')) {
    cursor = resolve(cursor, segment)
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`Path claim cannot use a symlink alias: ${rawPath}`)
  }
  if (existsSync(absolutePath)) {
    const realPath = realpathOrResolved(absolutePath)
    const realRelative = relative(realpathOrResolved(rootDir), realPath).replaceAll('\\', '/')
    if (realRelative === '..' || realRelative.startsWith('../')) throw new Error(`Path claim resolves outside the repository: ${rawPath}`)
    return realRelative
  }
  return relativePath
}

export function assertWorktreeCleanupSafe(rootDir: string) {
  const output = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: rootDir, encoding: 'utf8' })
  const materialChanges = output
    .split('\n')
    .filter(Boolean)
    .filter(line => {
      const path = line.slice(3).replaceAll('\\', '/')
      return path !== '.pipeline-state.json' && !path.startsWith('.pipeline/')
    })
  if (materialChanges.length) throw new Error(`Dirty worktree cleanup refused; preserve ${materialChanges.length} material change(s) for inspection.`)
  return { safe: true as const, ignored_pipeline_state: output.split('\n').filter(line => line.includes('.pipeline')).length }
}

export function readCandidate(rootDir: string, pipelineDir?: string): CandidateIdentity | null {
  const stateDir = resolvePipelineStateDir(rootDir, pipelineDir)
  const candidate = safeReadJson(resolve(stateDir.absolute, 'candidate.json')) as CandidateIdentity | null
  if (candidate?.pipeline_dir && candidate.pipeline_dir !== stateDir.relative) {
    throw new Error(`Candidate is bound to pipeline directory ${String(candidate.pipeline_dir)} and cannot be read from ${stateDir.relative}.`)
  }
  return candidate
}

export function writeCandidate(rootDir: string, candidate: CandidateIdentity, pipelineDir?: string) {
  const stateDir = resolveCandidatePipelineStateDir(rootDir, candidate, pipelineDir)
  const path = resolve(stateDir.absolute, 'candidate.json')
  atomicWriteJson(path, candidate)
  return path
}

export function readJsonDocument(path: string) {
  return safeReadJson(path)
}

function inspectGit(rootDir: string, baseBranch: string, pipelineDir: string) {
  const run = (args: string[]) => execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const worktreePath = realpathOrResolved(run(['rev-parse', '--show-toplevel']))
  const branch = run(['branch', '--show-current']) || 'DETACHED'
  const headSha = run(['rev-parse', 'HEAD'])
  const repository = safeGit(run, ['config', '--get', 'remote.origin.url'])
  if (!repository) throw new Error('Unable to observe remote.origin.url for repository identity.')
  const baseSha = firstGitResult(run, [
    ['merge-base', 'HEAD', `origin/${baseBranch}`],
    ['merge-base', 'HEAD', baseBranch],
  ])
  const stateExclusions = pipelineDir === '.pipeline' || pipelineDir.startsWith('.pipeline/')
    ? []
    : [`:(exclude,literal)${pipelineDir}`, `:(exclude,glob)${pipelineDir}/**`]
  const materialDiff = run(['diff', '--binary', 'HEAD', '--', '.', ':(exclude).pipeline/**', ':(exclude).pipeline-state.json', ...stateExclusions])
  const untrackedFiles = run(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .map(path => path.replaceAll('\\', '/'))
    .filter(path => path !== '.pipeline-state.json' && !path.startsWith('.pipeline/') && path !== pipelineDir && !path.startsWith(`${pipelineDir}/`))
    .sort()
    .map(path => ({ path, digest: digestFile(resolve(rootDir, path)) }))
  return { worktreePath, branch, headSha, repository, baseSha, dirtyFingerprint: hashValue({ materialDiff, untrackedFiles }) }
}

export function normalizeRepositoryIdentity(value: string) {
  const trimmed = String(value ?? '').trim().replace(/\/$/, '')
  const sshMatch = trimmed.match(/^[^@]+@([^:]+):(.+)$/)
  if (sshMatch) return canonicalRepositoryAddress(sshMatch[1], sshMatch[2])

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      return canonicalRepositoryAddress(url.host, url.pathname)
    } catch {
      return trimmed.toLowerCase()
    }
  }

  const path = normalizeRepositoryPath(trimmed)
  return path.split('/').length === 2 ? `github.com/${path}` : path
}

function canonicalRepositoryAddress(host: string, path: string) {
  return `${host.trim().toLowerCase()}/${normalizeRepositoryPath(path)}`
}

function normalizeRepositoryPath(path: string) {
  return path.trim().replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').toLowerCase()
}

function safeGit(run: (args: string[]) => string, args: string[]) {
  try {
    return run(args)
  } catch {
    return ''
  }
}

function firstGitResult(run: (args: string[]) => string, commands: string[][]) {
  for (const command of commands) {
    try {
      const value = run(command)
      if (value) return value
    } catch {
      // Try the next immutable base reference.
    }
  }
  throw new Error('Unable to resolve a Git base SHA.')
}

function digestPolicy(rootDir: string, releaseAdapterPath?: string) {
  const roots = [...TRUST_ROOTS]
  if (releaseAdapterPath) roots.push(releaseAdapterPath)
  const files = roots.flatMap(path => collectFiles(resolve(rootDir, path), rootDir)).sort()
  return hashValue(files.map(path => ({ path, digest: digestFile(resolve(rootDir, path)) })))
}

function collectFiles(path: string, rootDir: string, visitedDirectories = new Set<string>()): string[] {
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return [relative(rootDir, path)]
  const realDirectory = realpathOrResolved(path)
  if (visitedDirectories.has(realDirectory)) return []
  visitedDirectories.add(realDirectory)
  return readdirSync(path).flatMap(name => collectFiles(resolve(path, name), rootDir, visitedDirectories))
}

function pathsOverlap(left: string, right: string) {
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  const leftPath = normalize(left)
  const rightPath = normalize(right)
  return leftPath === rightPath || leftPath.startsWith(`${rightPath}/`) || rightPath.startsWith(`${leftPath}/`)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function candidateAddress(candidate: Omit<CandidateIdentity, 'candidate_id'> | CandidateIdentity) {
  const address = { ...candidate } as Partial<CandidateIdentity>
  delete address.candidate_id
  delete address.created_at
  if (address.declared_repository === undefined) delete address.declared_repository
  return address
}

function resolveCandidatePipelineStateDir(rootDir: string, candidate: CandidateIdentity, requested?: string) {
  const stateDir = resolvePipelineStateDir(rootDir, requested ?? candidate.pipeline_dir)
  const boundStateDir = resolvePipelineStateDir(rootDir, candidate.pipeline_dir)
  if (stateDir.relative !== boundStateDir.relative) {
    throw new Error(`Candidate ${candidate.candidate_id} is bound to pipeline directory ${boundStateDir.relative}; refusing namespace ${stateDir.relative}.`)
  }
  return stateDir
}

function resolveWritablePipelineStateDir(rootDir: string, requested?: string) {
  if (!requested) throw new Error('A canonical pipeline issue/run namespace is required for mutation.')
  const stateDir = resolvePipelineStateDir(rootDir, requested)
  if (stateDir.relative === '.pipeline') throw new Error('Legacy root .pipeline is read-only; select a canonical issue/run namespace.')
  return stateDir
}

function assertStateDocumentNamespace(document: Record<string, unknown> | null, pipelineDir: string, path: string) {
  if (document && document.pipeline_dir !== pipelineDir) {
    throw new Error(`State document ${path} is not bound to pipeline directory ${pipelineDir}.`)
  }
}

function safeReadJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function realpathOrResolved(path: string) {
  const resolved = resolve(path)
  return existsSync(resolved) ? realpathSync(resolved).replaceAll(sep, '/') : resolved.replaceAll(sep, '/')
}
