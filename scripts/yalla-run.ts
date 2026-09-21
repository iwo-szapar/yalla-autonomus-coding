#!/usr/bin/env tsx

import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { basename, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { loadYallaConfig, type LoadedYallaConfig } from './yalla-config.js'
import {
  CONTROL_SCHEMA_VERSION,
  PROTECTED_CAPABILITIES,
  YALLA_CONTROL_VERSION,
  artifactFreshness,
  atomicWriteJson,
  atomicWriteText,
  bindArtifact,
  canonicalPipelineStateDir,
  createCandidateIdentity,
  checkRemoteJobBudget,
  completeOperationReceipt,
  completeRemoteJob,
  detectPathOverlaps,
  findUnownedChangedPaths,
  isCapability,
  normalizeFailureClass,
  normalizePathClaims,
  normalizeRepositoryIdentity,
  readCandidate,
  recordOperationReceipt,
  recordRemoteJob,
  resolvePipelineStateDir,
  listMaterialChangedPaths,
  routeFailure,
  validateCandidate,
  validatePathAttribution,
  withRunLock,
  writeCandidate,
  type CandidateIdentity,
  type FailureClass,
  type RemoteJob,
  type PathClaim,
} from './yalla-control.js'
import { loadReleaseAdapter, validateAdapterIdentityForCandidate } from './yalla-release-adapter.js'
import { validateEvidenceGates } from '../eval/yalla/schemas/evidence-gates.js'

const execFileAsync = promisify(execFile)

type RunPhase = 'classify' | 'track' | 'plan' | 'work' | 'test' | 'review' | 'compound' | 'ship'
type Verdict = 'PROVEN' | 'NOT_PROVEN' | 'INCONCLUSIVE' | 'UNKNOWN'
type CommandResult = { stdout: string; stderr: string; exitCode: number }
type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>
type LoopDecision =
  | 'continue'
  | 'stop-proven'
  | 'stop-inconclusive'
  | 'stop-budget'
  | 'stop-baseline'
  | 'retry-infra'
  | 'stop-identity'
  | 'stop-policy'
  | 'stop-superseded'
  | 'blocked'

export type YallaRunEvent = {
  id: string
  ts: string
  event: string
  phase?: string
  run_id?: string
  properties: Record<string, unknown>
}

type Check = {
  name: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

type RunOptions = {
  command: 'event' | 'checkpoint' | 'status' | 'report' | 'doctor' | 'resume' | 'rewind' | 'export' | 'goal' | 'candidate' | 'baseline' | 'preflight' | 'stamp' | 'ownership' | 'evaluate' | 'loop' | 'operation' | 'remote-job' | 'mine-sessions'
  rootDir?: string
  configPath?: string
  pipelineDir?: string
  event?: string
  phase?: string
  runId?: string
  message?: string
  target?: string
  verdict?: string
  criteria?: string[]
  constraint?: string[]
  evidence?: string[]
  forbiddenShortcut?: string[]
  evaluator?: string
  finding?: string[]
  issueId?: string
  failureClass?: string
  operationId?: string
  capability?: string
  action?: string
  operationStatus?: string
  jobKind?: string
  jobStatus?: string
  artifactAction?: string
  durationSeconds?: number
  cost?: number
  retryReason?: string
  input?: string[]
  commandRunner?: CommandRunner
  now?: () => string
}

type RunContext = {
  rootDir: string
  pipelineDir: string
  pipelinePath: string
}

export type YallaRunResult = {
  exitCode: number
  eventPath?: string
  checkpointPath?: string
  status?: Record<string, unknown>
  reportPath?: string
  exportPath?: string
  goalPath?: string
  candidatePath?: string
  baselinePath?: string
  evaluatorPath?: string
  loopPath?: string
  operationPath?: string
  telemetryPath?: string
  artifactPath?: string
  miningPath?: string
  checks?: Check[]
  instruction?: string
}

const PHASE_ORDER: RunPhase[] = ['classify', 'track', 'plan', 'work', 'test', 'review', 'compound', 'ship']
const MODEL_KEYS = new Set(['classify', 'plan', 'implement', 'test', 'review', 'summarize'])
const VERIFIER_KEYS = new Set(['api', 'ui', 'perf', 'docs', 'research', 'visual', 'benchmark', 'security', 'accessibility'])
const MUTATING_RUN_COMMANDS = new Set<RunOptions['command']>(['event', 'checkpoint', 'report', 'export', 'goal', 'candidate', 'baseline', 'stamp', 'ownership', 'evaluate', 'loop', 'operation', 'remote-job', 'mine-sessions'])
const ARTIFACT_INPUTS: Record<string, string[]> = {
  'classification.json': ['goal-contract.json'],
  'acceptance-trace.json': ['goal-contract.json'],
  'test-evidence.json': ['goal-contract.json', 'baseline.json', 'acceptance-trace.json'],
  'review-results.json': ['goal-contract.json', 'baseline.json', 'acceptance-trace.json', 'test-evidence.json'],
  'outcome-evaluation.json': ['goal-contract.json', 'classification.json', 'baseline.json', 'acceptance-trace.json', 'test-evidence.json', 'review-results.json'],
}

const runContextStorage = new AsyncLocalStorage<RunContext>()

function activeRunContext(rootDir: string): RunContext {
  const active = runContextStorage.getStore()
  if (active) return active
  const state = resolvePipelineStateDir(rootDir)
  return { rootDir, pipelineDir: state.absolute, pipelinePath: state.relative }
}

function pipelineFile(rootDir: string, name: string) {
  return resolve(activeRunContext(rootDir).pipelineDir, name)
}

function pipelineRef(rootDir: string, name: string) {
  return `${activeRunContext(rootDir).pipelinePath}/${name}`
}

function validateRunNamespace(context: RunContext, options: RunOptions): string | undefined {
  const goalPath = resolve(context.pipelineDir, 'goal-contract.json')
  const candidatePath = resolve(context.pipelineDir, 'candidate.json')
  const goal = readJson(goalPath)
  const candidate = readJson(candidatePath)
  const issueId = String(options.issueId ?? '').trim()
  const runId = String(options.runId ?? '').trim()

  if (existsSync(goalPath) && !goal) return `POLICY_BLOCKED: ${context.pipelinePath}/goal-contract.json is invalid JSON; preserve or repair it before mutation.`
  if (existsSync(candidatePath) && !candidate) return `POLICY_BLOCKED: ${context.pipelinePath}/candidate.json is invalid JSON; preserve or repair it before mutation.`
  if (options.command === 'goal' && !goal && existsSync(context.pipelineDir)) {
    const foreignArtifacts = listDirectoryFiles(context.pipelineDir)
    if (foreignArtifacts.length) return `POLICY_BLOCKED: ${context.pipelinePath} already contains unbound evidence (${foreignArtifacts.join(', ')}); choose a fresh --pipeline-dir.`
  }

  const validateIdentity = (document: Record<string, unknown> | null, label: string) => {
    if (!document) return undefined
    const storedIssue = String(document.issue_id ?? '').trim()
    const storedRun = String(document.run_id ?? '').trim()
    const storedPipeline = String(document.pipeline_dir ?? '').trim()
    if (!storedIssue || !storedRun || !storedPipeline) {
      return `POLICY_BLOCKED: ${context.pipelinePath}/${label} is legacy or unbound state. Preserve it as read-only evidence or choose a fresh --pipeline-dir.`
    }
    if (storedPipeline !== context.pipelinePath) return `IDENTITY_MISMATCH: ${label} is bound to pipeline directory ${storedPipeline}, not ${context.pipelinePath}.`
    if (storedIssue !== issueId) return `IDENTITY_MISMATCH: ${label} belongs to issue ${storedIssue}, not ${issueId}.`
    if (storedRun !== runId) return `IDENTITY_MISMATCH: ${label} belongs to run ${storedRun}, not ${runId}.`
    return undefined
  }

  const goalError = validateIdentity(goal, 'goal-contract.json')
  if (goalError) return goalError
  const candidateError = validateIdentity(candidate, 'candidate.json')
  if (candidateError) return candidateError

  if (options.command !== 'goal' && options.command !== 'doctor' && !goal) {
    return `POLICY_BLOCKED: create ${context.pipelinePath}/goal-contract.json with stable issue/run identity before ${options.command}.`
  }
  if (options.command === 'candidate' && (goal?.issue_id !== issueId || goal?.run_id !== runId || goal?.pipeline_dir !== context.pipelinePath)) {
    return 'IDENTITY_MISMATCH: candidate identity must exactly match the active goal contract issue, run, and pipeline directory.'
  }
  return undefined
}

function resolveArtifactTarget(rootDir: string, requested: string | undefined, fallback: string) {
  const context = activeRunContext(rootDir)
  const normalized = String(requested || fallback).replaceAll('\\', '/')
  const name = normalized.includes('/') ? relative(context.pipelinePath, normalized).replaceAll('\\', '/') : normalized
  if (!name || name === '..' || name.startsWith('../') || name.includes('/') || !name.endsWith('.json')) {
    throw new Error(`Artifact target must be a JSON file directly inside ${context.pipelinePath}.`)
  }
  return { name, path: resolve(context.pipelineDir, name), reference: `${context.pipelinePath}/${name}` }
}

const PORTABLE_GATE_BINDINGS = [
  { classificationField: 'external_grounding_gate', reasonField: 'external_grounding_gate_reason', evidenceField: 'external_grounding', reviewCheck: 'external-grounding-check' },
  { classificationField: 'runtime_e2e_gate', reasonField: 'runtime_e2e_gate_reason', evidenceField: 'runtime_e2e_preflight', reviewCheck: 'runtime-e2e-proof-check' },
  { classificationField: 'surface_parity', evidenceField: 'surface_parity', reviewCheck: 'surface-parity-check' },
  { classificationField: 'trust_map', evidenceField: 'trust_map', reviewCheck: 'trust-map-check' },
  { classificationField: 'volume_envelope', evidenceField: 'volume_envelope', reviewCheck: 'volume-envelope-check' },
  { classificationField: 'lifecycle_states', evidenceField: 'lifecycle_states', reviewCheck: 'lifecycle-state-check' },
  { classificationField: 'ui_proof', evidenceField: 'ui_proof', reviewCheck: 'ui-proof-check' },
] as const

function parseArgs(argv: string[]): RunOptions {
  const command = argv[0]
  if (!isCommand(command)) throw new Error('Usage: tsx scripts/yalla-run.ts event|checkpoint|status|report|doctor|resume|rewind|export|goal|candidate|baseline|preflight|stamp|ownership|evaluate|loop|operation|remote-job|mine-sessions [options]')

  const options: RunOptions = { command, criteria: [], constraint: [], evidence: [], forbiddenShortcut: [], finding: [], input: [] }
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--config') options.configPath = argv[++index] ?? ''
    else if (arg === '--pipeline-dir') options.pipelineDir = argv[++index] ?? ''
    else if (arg === '--event') options.event = argv[++index] ?? ''
    else if (arg === '--phase') options.phase = argv[++index] ?? ''
    else if (arg === '--message') options.message = argv[++index] ?? ''
    else if (arg === '--target') options.target = argv[++index] ?? ''
    else if (arg === '--run-id') options.runId = argv[++index] ?? ''
    else if (arg === '--verdict') options.verdict = argv[++index] ?? ''
    else if (arg === '--criterion') options.criteria?.push(argv[++index] ?? '')
    else if (arg === '--constraint') options.constraint?.push(argv[++index] ?? '')
    else if (arg === '--evidence') options.evidence?.push(argv[++index] ?? '')
    else if (arg === '--forbid') options.forbiddenShortcut?.push(argv[++index] ?? '')
    else if (arg === '--evaluator') options.evaluator = argv[++index] ?? ''
    else if (arg === '--finding') options.finding?.push(argv[++index] ?? '')
    else if (arg === '--issue-id') options.issueId = argv[++index] ?? ''
    else if (arg === '--failure-class') options.failureClass = argv[++index] ?? ''
    else if (arg === '--operation-id') options.operationId = argv[++index] ?? ''
    else if (arg === '--capability') options.capability = argv[++index] ?? ''
    else if (arg === '--action') options.action = argv[++index] ?? ''
    else if (arg === '--operation-status') options.operationStatus = argv[++index] ?? ''
    else if (arg === '--job-kind') options.jobKind = argv[++index] ?? ''
    else if (arg === '--job-status') options.jobStatus = argv[++index] ?? ''
    else if (arg === '--artifact-action') options.artifactAction = argv[++index] ?? ''
    else if (arg === '--duration-seconds') options.durationSeconds = Number(argv[++index] ?? '')
    else if (arg === '--cost') options.cost = Number(argv[++index] ?? '')
    else if (arg === '--retry-reason') options.retryReason = argv[++index] ?? ''
    else if (arg === '--input') options.input?.push(argv[++index] ?? '')
    else throw new Error(`Unknown arg: ${arg}`)
  }
  return options
}

function isCommand(value: string | undefined): value is RunOptions['command'] {
  return value === 'event' || value === 'checkpoint' || value === 'status' || value === 'report' || value === 'doctor' || value === 'resume' || value === 'rewind' || value === 'export' || value === 'goal' || value === 'candidate' || value === 'baseline' || value === 'preflight' || value === 'stamp' || value === 'ownership' || value === 'evaluate' || value === 'loop' || value === 'operation' || value === 'remote-job' || value === 'mine-sessions'
}

async function defaultCommandRunner(command: string, args: string[]): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, { encoding: 'utf8' })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number }
    return { stdout: failed.stdout ?? '', stderr: failed.stderr ?? '', exitCode: Number(failed.code ?? 1) }
  }
}

export async function runYallaRun(options: RunOptions): Promise<YallaRunResult> {
  const initialRootDir = options.rootDir ?? process.cwd()
  const loadedConfig = loadYallaConfig({ rootDir: initialRootDir, configPath: options.configPath })
  const rootDir = options.rootDir ?? loadedConfig.rootDir
  const now = options.now ?? (() => new Date().toISOString())
  const commandRunner = options.commandRunner ?? defaultCommandRunner

  if (options.command === 'preflight') return runReleasePreflight()

  let state: ReturnType<typeof resolvePipelineStateDir>
  try {
    const canonicalState = canonicalPipelineStateDir(options.issueId, options.runId)
    state = resolvePipelineStateDir(rootDir, options.pipelineDir ?? canonicalState)
    if (state.relative !== canonicalState) throw new Error(`Issue/run identity requires pipeline directory ${canonicalState}, not ${state.relative}.`)
  } catch (error) {
    return { exitCode: 1, instruction: `IDENTITY_MISMATCH: ${error instanceof Error ? error.message : String(error)}` }
  }
  const context: RunContext = { rootDir, pipelineDir: state.absolute, pipelinePath: state.relative }

  const execute = async () => {
    const namespaceError = validateRunNamespace(context, options)
    if (namespaceError) return { exitCode: 1, instruction: namespaceError }
    if (options.command === 'event') return recordEvent(rootDir, options, now)
    if (options.command === 'checkpoint') return writeCheckpoint(rootDir, loadedConfig, options, now)
    if (options.command === 'status') return readStatus(rootDir, loadedConfig)
    if (options.command === 'report') return writeReport(rootDir, loadedConfig)
    if (options.command === 'doctor') return runDoctor(rootDir, loadedConfig, commandRunner)
    if (options.command === 'resume') return resumeInstruction(rootDir, loadedConfig)
    if (options.command === 'rewind') return rewindInstruction(rootDir, options.target)
    if (options.command === 'export') return exportBundle(rootDir, loadedConfig)
    if (options.command === 'goal') return writeGoalContract(rootDir, loadedConfig, options, now)
    if (options.command === 'candidate') return writeCandidateIdentity(rootDir, loadedConfig, options, now)
    if (options.command === 'baseline') return writeBaseline(rootDir, loadedConfig, options, now)
    if (options.command === 'stamp') return stampArtifact(rootDir, loadedConfig, options, now)
    if (options.command === 'ownership') return validateOwnership(rootDir, loadedConfig, options, now)
    if (options.command === 'evaluate') return writeEvaluatorResult(rootDir, loadedConfig, options, now)
    if (options.command === 'loop') return writeLoopState(rootDir, loadedConfig, now)
    if (options.command === 'operation') return writeOperation(rootDir, loadedConfig, options, now)
    if (options.command === 'remote-job') return writeRemoteJob(rootDir, loadedConfig, options, now)
    return writeSessionMiningReport(rootDir, loadedConfig, now)
  }

  return runContextStorage.run(context, async () => {
    try {
      if (MUTATING_RUN_COMMANDS.has(options.command)) return await withRunLock(rootDir, `yalla-run:${options.command}`, execute, context.pipelineDir)
      return await execute()
    } catch (error) {
      return { exitCode: 1, instruction: error instanceof Error ? error.message : String(error) }
    }
  })
}

function recordEvent(rootDir: string, options: RunOptions, now: () => string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const path = resolve(pipelineDir, 'events.jsonl')
  const candidate = readCandidate(rootDir, activeRunContext(rootDir).pipelineDir)
  const goal = readJson(pipelineFile(rootDir, 'goal-contract.json'))
  const event: YallaRunEvent = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: now(),
    event: options.event || 'run.note',
    phase: options.phase,
    run_id: options.runId ?? candidate?.run_id ?? String(goal?.run_id ?? ''),
    properties: { message: options.message ?? '', issue_id: options.issueId ?? candidate?.issue_id ?? goal?.issue_id ?? null, pipeline_dir: activeRunContext(rootDir).pipelinePath, candidate_id: candidate?.candidate_id ?? null, candidate_sha: candidate?.head_sha ?? null },
  }
  writeFileSync(path, `${JSON.stringify(event)}\n`, { flag: 'a' })
  return { exitCode: 0, eventPath: path, status: event as unknown as Record<string, unknown> }
}

function writeCheckpoint(rootDir: string, loadedConfig: LoadedYallaConfig, options: RunOptions, now: () => string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const checkpointsDir = resolve(pipelineDir, 'checkpoints')
  mkdirSync(checkpointsDir, { recursive: true })
  const phase = normalizePhase(options.phase)
  const status = buildStatus(rootDir, loadedConfig)
  const candidate = readCandidate(rootDir, activeRunContext(rootDir).pipelineDir)
  const path = resolve(checkpointsDir, `${String(Date.now())}-${phase}.json`)
  const checkpointContent = {
    schema_version: CONTROL_SCHEMA_VERSION,
    ts: now(),
    phase,
    run_id: options.runId,
    message: options.message ?? '',
    verdict: status.verdict,
    completed_phases: completedPhases(phase),
    artifacts: listPipelineArtifacts(rootDir),
    path,
  }
  const checkpoint = candidate ? bindArtifact(checkpointContent, candidate, 'yalla-run:checkpoint', [pipelineRef(rootDir, 'goal-contract.json')], now) : checkpointContent
  atomicWriteJson(path, checkpoint)
  atomicWriteJson(resolve(pipelineDir, 'latest-checkpoint.json'), checkpoint)
  recordEvent(rootDir, { ...options, command: 'event', event: 'checkpoint.completed', message: options.message }, now)
  return { exitCode: 0, checkpointPath: path, status: checkpoint }
}

function readStatus(rootDir: string, loadedConfig: LoadedYallaConfig): YallaRunResult {
  return { exitCode: 0, status: buildStatus(rootDir, loadedConfig) }
}

function buildStatus(rootDir: string, loadedConfig?: LoadedYallaConfig) {
  const latest = readJson(pipelineFile(rootDir, 'latest-checkpoint.json'))
  const classification = readJson(pipelineFile(rootDir, 'classification.json'))
  const outcome = readJson(pipelineFile(rootDir, 'outcome-evaluation.json'))
  const acceptance = readJson(pipelineFile(rootDir, 'acceptance-trace.json'))
  const review = readJson(pipelineFile(rootDir, 'review-results.json'))
  const goal = readJson(pipelineFile(rootDir, 'goal-contract.json'))
  const evaluator = readJson(pipelineFile(rootDir, 'evaluator-results.json'))
  const candidate = readCandidate(rootDir, activeRunContext(rootDir).pipelineDir)
  const candidateValidation = candidate ? validateCandidate(candidate, candidateValidationOptions(rootDir, loadedConfig, candidate)) : null
  const checkpointFreshness = artifactFreshness(latest, candidate)
  const outcomeFreshness = artifactFreshness(outcome, candidate)
  const evaluatorResults = Array.isArray(evaluator?.results) ? evaluator.results as Array<Record<string, unknown>> : []
  const currentEvaluatorResults = candidate
    ? evaluatorResults.filter(result => artifactFreshness(result, candidate).status === 'CURRENT')
    : []
  const events = readEvents(rootDir)
  const telemetry = buildTelemetry(events)
  const candidateExact = candidateValidation?.state === 'RESUMABLE_EXACT'
  const checkpointUsableForPhase = !candidate || (candidateExact && checkpointFreshness.status === 'CURRENT')
  const phase = String((checkpointUsableForPhase ? latest?.phase : undefined) ?? classification?.phase ?? 'unknown')
  const verdict = candidateExact && outcomeFreshness.status === 'CURRENT' ? readVerdict(outcome) : 'UNKNOWN'
  const budget = loadedConfig ? budgetState(loadedConfig, events) : budgetFromGoal(goal, events)
  return {
    schema_version: CONTROL_SCHEMA_VERSION,
    yalla_version: YALLA_CONTROL_VERSION,
    pipeline_dir: activeRunContext(rootDir).pipelinePath,
    issue_id: goal?.issue_id ?? null,
    run_id: goal?.run_id ?? null,
    phase,
    verdict,
    candidate_id: candidate?.candidate_id ?? null,
    candidate_sha: candidate?.head_sha ?? null,
    candidate_state: candidateValidation?.state ?? 'UNBOUND',
    candidate_reasons: candidateValidation?.reasons ?? ['no active candidate'],
    artifact_freshness: {
      checkpoint: checkpointFreshness.status,
      outcome: outcomeFreshness.status,
      evaluator: candidate && evaluator ? (currentEvaluatorResults.length === evaluatorResults.length ? 'CURRENT' : 'STALE') : 'UNBOUND',
    },
    latest_checkpoint: latest?.path ?? null,
    completed_phases: latest?.completed_phases ?? [],
    artifacts: listPipelineArtifacts(rootDir),
    acceptance_criteria: Array.isArray(acceptance?.criteria) ? acceptance.criteria.length : null,
    review_checks: Array.isArray(review?.checks) ? review.checks.length : null,
    goal_contract: Boolean(goal),
    evaluator_results: currentEvaluatorResults.length,
    events: events.length,
    telemetry,
    budget,
    next_action: nextAction(phase, verdict),
  }
}

function writeReport(rootDir: string, loadedConfig: LoadedYallaConfig): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const path = resolve(pipelineDir, 'report.html')
  const status = buildStatus(rootDir, loadedConfig)
  const events = readEvents(rootDir)
  atomicWriteText(path, renderReport(rootDir, loadedConfig, status, events))
  return { exitCode: 0, reportPath: path, status }
}

async function runDoctor(rootDir: string, loadedConfig: LoadedYallaConfig, commandRunner: CommandRunner): Promise<YallaRunResult> {
  const config = loadedConfig.config
  const checks: Check[] = []
  checks.push({ name: 'config', status: loadedConfig.path ? 'pass' : 'fail', detail: loadedConfig.path ?? 'Missing .claude/YALLA.md or --config path' })
  const baseBranch = config.baseBranch ?? ''
  let baseResolved = false
  if (baseBranch) {
    const remoteBase = await commandRunner('git', ['rev-parse', '--verify', `origin/${baseBranch}`])
    const localBase = remoteBase.exitCode === 0 ? remoteBase : await commandRunner('git', ['rev-parse', '--verify', baseBranch])
    baseResolved = localBase.exitCode === 0
  }
  checks.push({ name: 'base_branch', status: baseBranch && baseResolved ? 'pass' : 'fail', detail: baseBranch ? (baseResolved ? `${baseBranch} resolves` : `${baseBranch} does not resolve locally or as origin/${baseBranch}`) : 'Missing base_branch' })
  checks.push({ name: 'commands.test', status: config.commands.test ? 'pass' : 'fail', detail: config.commands.test ?? 'Missing test command' })
  checks.push({ name: 'commands.typecheck', status: config.commands.typecheck !== undefined ? 'pass' : 'warn', detail: config.commands.typecheck ?? 'Missing typecheck command or explicit empty string' })
  checks.push({ name: 'test_dir', status: config.testDir && existsSync(resolve(rootDir, config.testDir)) ? 'pass' : 'warn', detail: config.testDir ?? 'Missing test_dir' })
  checks.push(modelRoutingCheck(config.models))
  checks.push(verifierRegistryCheck(config.verifiers))
  checks.push({ name: 'capabilities', status: config.capabilities.allowed.length ? 'pass' : 'warn', detail: config.capabilities.allowed.join(', ') || 'No mutation capabilities granted' })
  const protectedDefaults = config.capabilities.allowed.filter(capability => PROTECTED_CAPABILITIES.has(capability))
  checks.push({
    name: 'protected_capability_defaults',
    status: protectedDefaults.length ? 'fail' : 'pass',
    detail: protectedDefaults.length
      ? `Protected capabilities cannot be authorized by the local runner and must remain with an external operator-controlled executor: ${protectedDefaults.join(', ')}`
      : 'No protected capability is granted persistently',
  })
  if (config.releaseAdapterPath) {
    const adapter = loadReleaseAdapter(rootDir, config.releaseAdapterPath)
    checks.push({ name: 'release_adapter', status: adapter.ok ? 'pass' : 'fail', detail: adapter.ok ? adapter.path : adapter.errors.join('; ') })
    if (adapter.ok) {
      const expectedRepository = config.repo?.trim()
      const observedRemote = await commandRunner('git', ['config', '--get', 'remote.origin.url'])
      const observedRepository = observedRemote.exitCode === 0 ? observedRemote.stdout.trim() : ''
      const identitiesMatch = Boolean(expectedRepository && observedRepository)
        && normalizeRepositoryIdentity(adapter.adapter.project_identity.repository) === normalizeRepositoryIdentity(expectedRepository as string)
        && normalizeRepositoryIdentity(expectedRepository as string) === normalizeRepositoryIdentity(observedRepository)
      checks.push({
        name: 'release_adapter_identity',
        status: identitiesMatch ? 'pass' : 'fail',
        detail: `adapter=${adapter.adapter.project_identity.repository}; config=${expectedRepository ?? '<auto>'}; origin=${observedRepository || '<missing>'}`,
      })
    }
  } else {
    checks.push({ name: 'release_adapter', status: 'warn', detail: 'No release adapter configured; valid for T0 work' })
  }
  const candidate = readCandidate(rootDir, activeRunContext(rootDir).pipelineDir)
  if (candidate) {
    const validation = validateCandidate(candidate, candidateValidationOptions(rootDir, loadedConfig, candidate))
    checks.push({ name: 'candidate_identity', status: validation.state === 'RESUMABLE_EXACT' ? 'pass' : 'fail', detail: `${validation.state}${validation.reasons.length ? `: ${validation.reasons.join('; ')}` : ''}` })
  } else {
    checks.push({ name: 'candidate_identity', status: 'warn', detail: 'No candidate initialized; required before final review or candidate-bound proof' })
  }
  const git = await commandRunner('git', ['rev-parse', '--is-inside-work-tree'])
  checks.push({ name: 'git_repo', status: git.exitCode === 0 ? 'pass' : 'fail', detail: git.exitCode === 0 ? 'Git repository detected' : 'Not inside a Git repository' })
  const gh = await commandRunner('gh', ['auth', 'status'])
  checks.push({ name: 'github_auth', status: gh.exitCode === 0 ? 'pass' : 'warn', detail: gh.exitCode === 0 ? 'gh authenticated' : 'gh unavailable or unauthenticated' })
  const state = activeRunContext(rootDir)
  checks.push({ name: 'pipeline_dir', status: existsSync(state.pipelineDir) ? 'pass' : 'warn', detail: existsSync(state.pipelineDir) ? `${state.pipelinePath} exists` : `${state.pipelinePath} will be created by the goal command` })
  const hasFailure = checks.some(check => check.status === 'fail')
  return { exitCode: hasFailure ? 1 : 0, checks }
}

function resumeInstruction(rootDir: string, loadedConfig: LoadedYallaConfig): YallaRunResult {
  const status = buildStatus(rootDir, loadedConfig)
  const latest = status.latest_checkpoint ? String(status.latest_checkpoint) : ''
  const candidateState = String(status.candidate_state)
  if (!latest) return { exitCode: 1, status, instruction: 'No checkpoint found. Start with classification, create the goal contract, then initialize an immutable candidate.' }
  const freshness = status.artifact_freshness as { checkpoint?: string } | undefined
  if (candidateState === 'RESUMABLE_EXACT' && freshness?.checkpoint === 'CURRENT') return { exitCode: 0, status, instruction: `RESUMABLE_EXACT: Resume from ${latest}. Continue with next action: ${status.next_action}` }
  if (candidateState === 'RESUMABLE_EXACT') return { exitCode: 1, status, instruction: 'RESUMABLE_AFTER_REVALIDATION: The latest checkpoint belongs to another or legacy candidate. Create a new checkpoint after revalidation.' }
  if (candidateState === 'UNBOUND') return { exitCode: 1, status, instruction: 'RESUMABLE_AFTER_REVALIDATION: Legacy checkpoint is not candidate-bound. Initialize a candidate and rerun required proof before continuing.' }
  return { exitCode: 1, status, instruction: `${candidateState}: ${String((status.candidate_reasons as string[]).join('; '))}. Do not reuse prior proof.` }
}

function rewindInstruction(rootDir: string, target?: string): YallaRunResult {
  const checkpoints = listCheckpoints(rootDir)
  if (!checkpoints.length) return { exitCode: 1, instruction: `No checkpoints found in ${activeRunContext(rootDir).pipelinePath}/checkpoints.` }
  const selected = target ? checkpoints.find(path => basename(path).includes(target)) : checkpoints.at(-2) ?? checkpoints.at(0)
  if (!selected) return { exitCode: 1, instruction: `No checkpoint matched ${target}. Available: ${checkpoints.map(path => basename(path)).join(', ')}` }
  return {
    exitCode: 0,
    instruction: `Rewind target selected: ${selected}. Reset manually only after inspecting the diff; Yalla does not run destructive git commands automatically.`,
    checkpointPath: selected,
  }
}

function exportBundle(rootDir: string, loadedConfig: LoadedYallaConfig): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const exportDir = resolve(pipelineDir, `export-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(exportDir, { recursive: true })
  for (const artifact of listPipelineArtifacts(rootDir)) {
    const source = resolve(pipelineDir, artifact)
    if (!existsSync(source) || statSync(source).isDirectory()) continue
    copyFileSync(source, resolve(exportDir, artifact))
  }
  atomicWriteJson(resolve(exportDir, 'status.json'), buildStatus(rootDir, loadedConfig))
  return { exitCode: 0, exportPath: exportDir, status: { exported_artifacts: listDirectoryFiles(exportDir) } }
}

function writeGoalContract(rootDir: string, loadedConfig: LoadedYallaConfig, options: RunOptions, now: () => string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const path = resolve(pipelineDir, 'goal-contract.json')
  const budget = budgetState(loadedConfig, readEvents(rootDir))
  const contract = {
    schema_version: CONTROL_SCHEMA_VERSION,
    yalla_version: YALLA_CONTROL_VERSION,
    version: 1,
    created_at: now(),
    issue_id: options.issueId,
    run_id: options.runId,
    pipeline_dir: activeRunContext(rootDir).pipelinePath,
    desired_end_state: options.message || 'Describe the desired end state before implementation starts.',
    success_criteria: cleanList(options.criteria),
    constraints: cleanList(options.constraint),
    budget: {
      max_iterations: budget.max_iterations,
      max_runtime_minutes: budget.max_runtime_minutes,
      token_budget: budget.token_budget,
    },
    forbidden_shortcuts: cleanList(options.forbiddenShortcut),
    required_evidence: cleanList(options.evidence),
    verifier_registry: loadedConfig.config.verifiers,
  }
  atomicWriteJson(path, contract)
  recordEvent(rootDir, { ...options, command: 'event', event: 'goal.contract.created', phase: options.phase ?? 'classify', message: contract.desired_end_state }, now)
  return { exitCode: 0, goalPath: path, status: contract }
}

function writeCandidateIdentity(rootDir: string, loadedConfig: LoadedYallaConfig, options: RunOptions, now: () => string): YallaRunResult {
  if (!existsSync(pipelineFile(rootDir, 'goal-contract.json'))) {
    return { exitCode: 1, instruction: `Create ${pipelineRef(rootDir, 'goal-contract.json')} before initializing a candidate.` }
  }
  try {
    const candidate = createCandidateIdentity({
      rootDir,
      repository: loadedConfig.config.repo,
      baseBranch: loadedConfig.config.baseBranch ?? 'main',
      runId: options.runId,
      issueId: options.issueId,
      pipelineDir: activeRunContext(rootDir).pipelineDir,
      configPath: loadedConfig.path,
      releaseAdapterPath: loadedConfig.config.releaseAdapterPath,
      now,
    })
    const candidatePath = writeCandidate(rootDir, candidate, activeRunContext(rootDir).pipelineDir)
    recordEvent(rootDir, { ...options, command: 'event', event: 'candidate.created', phase: options.phase ?? 'work', message: candidate.candidate_id }, now)
    return { exitCode: 0, candidatePath, status: candidate as unknown as Record<string, unknown> }
  } catch (error) {
    return { exitCode: 1, instruction: error instanceof Error ? error.message : String(error) }
  }
}

function writeBaseline(rootDir: string, loadedConfig: LoadedYallaConfig, options: RunOptions, now: () => string): YallaRunResult {
  const candidateResult = requireExactCandidate(rootDir, loadedConfig)
  if (!candidateResult.candidate) return { exitCode: 1, instruction: candidateResult.instruction }
  const path = resolve(ensurePipeline(rootDir), 'baseline.json')
  const baselineContent = {
    schema_version: CONTROL_SCHEMA_VERSION,
    captured_at: now(),
    base_sha: candidateResult.candidate.base_sha,
    head_sha: candidateResult.candidate.head_sha,
    inherited_failures: cleanList(options.finding),
    note: options.message ?? '',
  }
  const baseline = bindArtifact(baselineContent, candidateResult.candidate, 'yalla-run:baseline', [pipelineRef(rootDir, 'goal-contract.json')], now)
  atomicWriteJson(path, baseline)
  recordEvent(rootDir, { ...options, command: 'event', event: 'baseline.captured', phase: options.phase ?? 'test', message: `${baseline.inherited_failures.length} inherited failure(s)` }, now)
  return { exitCode: 0, baselinePath: path, status: baseline }
}

function runReleasePreflight(): YallaRunResult {
  return {
    exitCode: 1,
    instruction: 'POLICY_BLOCKED: the local Yalla runner never executes repository-supplied preflight commands. An external operator-controlled executor must verify provider identity and own consequential actions.',
  }
}

function stampArtifact(rootDir: string, loadedConfig: LoadedYallaConfig, options: RunOptions, now: () => string): YallaRunResult {
  const candidateResult = requireExactCandidate(rootDir, loadedConfig)
  if (!candidateResult.candidate) return { exitCode: 1, instruction: candidateResult.instruction }
  let artifact: ReturnType<typeof resolveArtifactTarget>
  try {
    artifact = resolveArtifactTarget(rootDir, options.target, '')
  } catch (error) {
    return { exitCode: 1, instruction: error instanceof Error ? error.message : String(error) }
  }
  const { name: target, path, reference } = artifact
  if (target === 'release-preflight.json' || target === 'preflight-output.json') {
    return { exitCode: 1, instruction: `${reference} is external-controller evidence and cannot be created or stamped by the local Yalla runner.` }
  }
  const document = readJson(path)
  if (!document) return { exitCode: 1, instruction: `Artifact is missing or invalid JSON: ${reference}` }
  const requestedInputs = [...(ARTIFACT_INPUTS[target] ?? ['goal-contract.json', 'baseline.json']), ...cleanList(options.input)]
  let inputArtifacts: Array<ReturnType<typeof resolveArtifactTarget>>
  try {
    inputArtifacts = [...new Map(requestedInputs.map(input => {
      const resolved = resolveArtifactTarget(rootDir, input, '')
      return [resolved.name, resolved]
    })).values()]
  } catch (error) {
    return { exitCode: 1, instruction: error instanceof Error ? error.message : String(error) }
  }
  const missingInputs = inputArtifacts.filter(input => !readJson(input.path))
  if (missingInputs.length) return { exitCode: 1, instruction: `Cannot bind ${reference}; required inputs are missing or invalid: ${missingInputs.map(input => input.reference).join(', ')}` }
  const staleInputs = inputArtifacts
    .filter(input => input.name !== 'goal-contract.json')
    .filter(input => artifactFreshness(readJson(input.path), candidateResult.candidate).status !== 'CURRENT')
  if (staleInputs.length) return { exitCode: 1, instruction: `Cannot bind ${reference}; required inputs are stale or unbound: ${staleInputs.map(input => input.reference).join(', ')}` }
  const proofError = validateProofArtifact(target, document, rootDir, candidateResult.candidate)
  if (proofError) return { exitCode: 1, instruction: proofError }
  const stampedContent: Record<string, unknown> = {
    ...document,
    schema_version: document.schema_version ?? CONTROL_SCHEMA_VERSION,
  }
  delete stampedContent._meta
  const stamped = bindArtifact(stampedContent, candidateResult.candidate, options.message || `yalla-run:stamp:${reference}`, inputArtifacts.map(input => input.reference), now)
  atomicWriteJson(path, stamped)
  return { exitCode: 0, artifactPath: path, status: stamped }
}

function validateOwnership(rootDir: string, loadedConfig: LoadedYallaConfig, options: RunOptions, now: () => string): YallaRunResult {
  const candidateResult = requireExactCandidate(rootDir, loadedConfig)
  if (!candidateResult.candidate) return { exitCode: 1, instruction: candidateResult.instruction }
  let artifact: ReturnType<typeof resolveArtifactTarget>
  try {
    artifact = resolveArtifactTarget(rootDir, options.target, 'path-ownership.json')
  } catch (error) {
    return { exitCode: 1, instruction: error instanceof Error ? error.message : String(error) }
  }
  const { path } = artifact
  const document = readJson(path)
  const rawClaims = Array.isArray(document?.claims) ? document.claims as PathClaim[] : []
  if (!rawClaims.length || rawClaims.some(claim => !claim.owner || !Array.isArray(claim.paths) || !claim.paths.length)) {
    return { exitCode: 1, instruction: 'Ownership artifact must contain non-empty `{ owner, paths[] }` claims.' }
  }
  let claims: PathClaim[]
  try {
    claims = normalizePathClaims(rootDir, rawClaims)
  } catch (error) {
    return { exitCode: 1, instruction: error instanceof Error ? error.message : String(error) }
  }
  const overlaps = detectPathOverlaps(claims)
  const changedPaths = listMaterialChangedPaths(rootDir)
  const unownedChangedPaths = findUnownedChangedPaths(changedPaths, claims)
  let attribution = { unattributed: [] as string[], falsely_claimed: [] as string[], multiply_attributed: [] as string[] }
  try {
    attribution = validatePathAttribution(changedPaths, claims)
  } catch (error) {
    return { exitCode: 1, instruction: error instanceof Error ? error.message : String(error) }
  }
  const resultContent: Record<string, unknown> = {
    ...document,
    claims,
    schema_version: CONTROL_SCHEMA_VERSION,
    validated_at: now(),
    overlaps,
    changed_paths: changedPaths,
    unowned_changed_paths: unownedChangedPaths,
    attribution,
    verdict: overlaps.length || unownedChangedPaths.length || attribution.unattributed.length || attribution.falsely_claimed.length || attribution.multiply_attributed.length ? 'CONFLICT' : 'PASS',
  }
  delete resultContent._meta
  const result = bindArtifact(resultContent, candidateResult.candidate, 'yalla-run:ownership', [pipelineRef(rootDir, 'goal-contract.json')], now)
  atomicWriteJson(path, result)
  return { exitCode: result.verdict === 'CONFLICT' ? 1 : 0, artifactPath: path, status: result }
}

function writeEvaluatorResult(rootDir: string, loadedConfig: LoadedYallaConfig, options: RunOptions, now: () => string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const path = resolve(pipelineDir, 'evaluator-results.json')
  const existing = readJson(path)
  const results = Array.isArray(existing?.results) ? existing.results : []
  const verdict = normalizeEvaluatorVerdict(options.verdict)
  const candidateResult = requireExactCandidate(rootDir, loadedConfig)
  if (!candidateResult.candidate) return { exitCode: 1, instruction: candidateResult.instruction }
  const failureClass = verdict === 'FAIL' ? normalizeFailureClass(options.failureClass) : undefined
  if (verdict === 'FAIL' && !failureClass) return { exitCode: 1, instruction: 'FAIL evaluator results require a valid --failure-class.' }
  const resultContent = {
    schema_version: CONTROL_SCHEMA_VERSION,
    ts: now(),
    evaluator: options.evaluator || 'independent-evaluator',
    verdict,
    phase: options.phase ?? buildStatus(rootDir).phase,
    findings: cleanList(options.finding),
    failure_class: failureClass,
    failure_action: failureClass ? routeFailure(failureClass) : undefined,
    next_instruction: options.message || evaluatorNextInstruction(verdict),
  }
  const result = bindArtifact(resultContent, candidateResult.candidate, 'yalla-run:evaluate', ['goal-contract.json', 'baseline.json', 'acceptance-trace.json', 'test-evidence.json', 'review-results.json'].map(name => pipelineRef(rootDir, name)), now)
  const document = { schema_version: CONTROL_SCHEMA_VERSION, yalla_version: YALLA_CONTROL_VERSION, version: 2, results: [...results, result] }
  atomicWriteJson(path, document)
  recordEvent(rootDir, { ...options, command: 'event', event: 'evaluator.completed', phase: result.phase, message: `${result.evaluator}: ${result.verdict}` }, now)
  return { exitCode: verdict === 'FAIL' ? 1 : 0, evaluatorPath: path, status: result }
}

function writeLoopState(rootDir: string, loadedConfig: LoadedYallaConfig, now: () => string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const path = resolve(pipelineDir, 'loop-state.json')
  const status = buildStatus(rootDir, loadedConfig)
  const goal = readJson(pipelineFile(rootDir, 'goal-contract.json'))
  const evaluator = readJson(pipelineFile(rootDir, 'evaluator-results.json'))
  const candidate = readCandidate(rootDir, activeRunContext(rootDir).pipelineDir)
  const evaluatorResults = Array.isArray(evaluator?.results) ? evaluator.results as Array<Record<string, unknown>> : []
  const latestEvaluator = candidate
    ? [...evaluatorResults].reverse().find(result => artifactFreshness(result, candidate).status === 'CURRENT')
    : undefined
  const decision = loopDecision(status, latestEvaluator)
  const loopStateContent = {
    schema_version: CONTROL_SCHEMA_VERSION,
    ts: now(),
    decision,
    iteration: status.budget?.iterations_used ?? 0,
    budget: status.budget,
    goal_present: Boolean(goal),
    evaluator_verdict: latestEvaluator?.verdict ?? null,
    failure_class: latestEvaluator?.failure_class ?? null,
    next_instruction: loopInstruction(decision, status, latestEvaluator),
  }
  const loopState = candidate ? bindArtifact(loopStateContent, candidate, 'yalla-run:loop', ['goal-contract.json', 'evaluator-results.json', 'outcome-evaluation.json'].map(name => pipelineRef(rootDir, name)), now) : loopStateContent
  atomicWriteJson(path, loopState)
  recordEvent(rootDir, { command: 'event', event: 'loop.evaluated', phase: String(status.phase ?? ''), message: `${decision}: ${loopState.next_instruction}` }, now)
  return { exitCode: decision === 'continue' ? 0 : decision === 'stop-proven' ? 0 : 1, loopPath: path, status: loopState }
}

function writeSessionMiningReport(rootDir: string, loadedConfig: LoadedYallaConfig, now: () => string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const path = resolve(pipelineDir, 'session-mining-report.json')
  recordEvent(rootDir, { command: 'event', event: 'sessions.mined', phase: 'compound', message: 'Session mining started' }, now)
  const events = readEvents(rootDir)
  const testEvidence = readJson(pipelineFile(rootDir, 'test-evidence.json'))
  const reviewResults = readJson(pipelineFile(rootDir, 'review-results.json'))
  const failedCommands = Array.isArray(testEvidence?.commands)
    ? (testEvidence.commands as Array<Record<string, unknown>>).filter(command => command.status && command.status !== 'pass')
    : []
  const failedReviews = Array.isArray(reviewResults?.checks)
    ? (reviewResults.checks as Array<Record<string, unknown>>).filter(check => check.verdict === 'FAIL' || check.status === 'fail')
    : []
  const reportContent = {
    schema_version: CONTROL_SCHEMA_VERSION,
    generated_at: now(),
    total_events: events.length,
    repeated_events: repeatedEventSummary(events),
    failed_commands: failedCommands,
    failed_reviews: failedReviews,
    blocker_patterns: events.filter(event => event.event.includes('blocked') || String(event.properties.message ?? '').toLowerCase().includes('blocked')),
    suggested_updates: suggestedSessionUpdates(events, failedCommands, failedReviews),
  }
  const candidate = readCandidate(rootDir, activeRunContext(rootDir).pipelineDir)
  const report = candidate ? bindArtifact(reportContent, candidate, 'yalla-run:mine-sessions', ['events.jsonl', 'test-evidence.json', 'review-results.json'].map(name => pipelineRef(rootDir, name)), now) : reportContent
  atomicWriteJson(path, report)
  return { exitCode: 0, miningPath: path, status: report }
}

function writeOperation(rootDir: string, loadedConfig: LoadedYallaConfig, options: RunOptions, now: () => string): YallaRunResult {
  if (!options.operationId || !options.capability || !options.action || !options.target) {
    return { exitCode: 1, instruction: 'operation requires --operation-id, --capability, --action, and --target.' }
  }
  if (!isCapability(options.capability)) return { exitCode: 1, instruction: `Unknown capability: ${options.capability}` }
  if (options.operationStatus !== undefined && !isOperationStatus(options.operationStatus)) {
    return { exitCode: 1, instruction: `Invalid --operation-status ${options.operationStatus}; expected pending, succeeded, or failed.` }
  }
  const operationStatus = options.operationStatus ?? 'pending'
  if (operationStatus === 'succeeded' || operationStatus === 'failed') {
    try {
      const completed = completeOperationReceipt({ rootDir, pipelineDir: activeRunContext(rootDir).pipelineDir, operationId: options.operationId, capability: options.capability, action: options.action, target: options.target, status: operationStatus, now })
      return { exitCode: 0, operationPath: pipelineFile(rootDir, 'operation-receipts.json'), status: completed as unknown as Record<string, unknown> }
    } catch (error) {
      return { exitCode: 1, instruction: error instanceof Error ? error.message : String(error) }
    }
  }
  if (PROTECTED_CAPABILITIES.has(options.capability)) return { exitCode: 1, instruction: `POLICY_BLOCKED: protected capability ${options.capability} cannot be authorized by the local Yalla runner; use an external operator-controlled executor.` }
  const candidateResult = requireExactCandidate(rootDir, loadedConfig)
  if (!candidateResult.candidate) return { exitCode: 1, instruction: candidateResult.instruction }
  try {
    const receipt = recordOperationReceipt({
      rootDir,
      pipelineDir: activeRunContext(rootDir).pipelineDir,
      candidate: candidateResult.candidate,
      allowedCapabilities: loadedConfig.config.capabilities.allowed,
      operationId: options.operationId,
      capability: options.capability,
      action: options.action,
      target: options.target,
      operationStatus,
      now,
    })
    return { exitCode: 0, operationPath: pipelineFile(rootDir, 'operation-receipts.json'), status: receipt as unknown as Record<string, unknown> }
  } catch (error) {
    return { exitCode: 1, instruction: error instanceof Error ? error.message : String(error) }
  }
}

function writeRemoteJob(rootDir: string, loadedConfig: LoadedYallaConfig, options: RunOptions, now: () => string): YallaRunResult {
  if (!options.operationId || !isRemoteJobKind(options.jobKind) || !isArtifactAction(options.artifactAction) || !isJobStatus(options.jobStatus)) {
    return { exitCode: 1, instruction: 'remote-job requires --operation-id, --job-kind, --job-status reserve|succeeded|failed, and --artifact-action built|reused.' }
  }
  const durationSeconds = options.durationSeconds ?? 0
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || (options.cost !== undefined && (!Number.isFinite(options.cost) || options.cost < 0))) {
    return { exitCode: 1, instruction: 'remote-job duration and optional cost must be non-negative finite numbers.' }
  }
  if (options.jobStatus !== 'reserve' && options.durationSeconds === undefined) return { exitCode: 1, instruction: 'Completing a remote job requires --duration-seconds.' }
  if (options.jobStatus === 'succeeded' || options.jobStatus === 'failed') {
    try {
      const completed = completeRemoteJob({ rootDir, pipelineDir: activeRunContext(rootDir).pipelineDir, operationId: options.operationId, kind: options.jobKind, artifactAction: options.artifactAction, status: options.jobStatus, durationSeconds, cost: options.cost, retryReason: options.retryReason, now })
      return { exitCode: 0, telemetryPath: pipelineFile(rootDir, 'remote-jobs.json'), status: completed as unknown as Record<string, unknown> }
    } catch (error) {
      return { exitCode: 1, instruction: error instanceof Error ? error.message : String(error) }
    }
  }
  const candidateResult = requireExactCandidate(rootDir, loadedConfig)
  if (!candidateResult.candidate) return { exitCode: 1, instruction: candidateResult.instruction }
  if (!loadedConfig.config.releaseAdapterPath) return { exitCode: 1, instruction: 'POLICY_BLOCKED: remote jobs require a validated release_adapter with per-candidate budgets.' }
  const adapter = loadReleaseAdapter(rootDir, loadedConfig.config.releaseAdapterPath)
  if (!adapter.ok) return { exitCode: 1, instruction: `Release adapter is invalid: ${adapter.errors.join('; ')}` }
  const adapterErrors = validateAdapterIdentityForCandidate(adapter.adapter, candidateResult.candidate)
  if (adapterErrors.length) return { exitCode: 1, instruction: `POLICY_BLOCKED: ${adapterErrors.join('; ')}` }
  if (options.jobStatus === 'reserve') {
    const budget = checkRemoteJobBudget({
      rootDir,
      pipelineDir: activeRunContext(rootDir).pipelineDir,
      candidate: candidateResult.candidate,
      operationId: options.operationId,
      kind: options.jobKind,
      artifactAction: options.artifactAction,
      budgets: adapter.adapter.budgets,
    })
    if (!budget.allowed) {
      recordRemoteJob({
        rootDir,
        pipelineDir: activeRunContext(rootDir).pipelineDir,
        candidate: candidateResult.candidate,
        operationId: options.operationId,
        kind: options.jobKind,
        artifactAction: options.artifactAction,
        status: 'blocked',
        durationSeconds: 0,
        retryReason: budget.reason,
        now,
      })
      return { exitCode: 1, telemetryPath: pipelineFile(rootDir, 'remote-jobs.json'), instruction: `POLICY_BLOCKED: ${budget.reason}` }
    }
  }
  try {
    const recorded = recordRemoteJob({
      rootDir,
      pipelineDir: activeRunContext(rootDir).pipelineDir,
      candidate: candidateResult.candidate,
      operationId: options.operationId,
      kind: options.jobKind,
      artifactAction: options.artifactAction,
      status: options.jobStatus === 'reserve' ? 'pending' : options.jobStatus,
      durationSeconds,
      cost: options.cost,
      retryReason: options.retryReason,
      now,
    })
    return { exitCode: 0, telemetryPath: pipelineFile(rootDir, 'remote-jobs.json'), status: recorded as unknown as Record<string, unknown> }
  } catch (error) {
    return { exitCode: 1, instruction: error instanceof Error ? error.message : String(error) }
  }
}

function modelRoutingCheck(models: Record<string, string>): Check {
  const keys = Object.keys(models)
  if (!keys.length) return { name: 'model_routing', status: 'warn', detail: 'No models block configured; default Claude Code model will be used for all phases' }
  const unknown = keys.filter(key => !MODEL_KEYS.has(key))
  if (unknown.length) return { name: 'model_routing', status: 'fail', detail: `Unknown model route(s): ${unknown.join(', ')}` }
  return { name: 'model_routing', status: 'pass', detail: keys.map(key => `${key}=${models[key]}`).join(', ') }
}

function verifierRegistryCheck(verifiers: Record<string, string>): Check {
  const keys = Object.keys(verifiers)
  if (!keys.length) return { name: 'verifier_registry', status: 'warn', detail: 'No verifiers block configured; agents must infer proof commands from project context' }
  const unknown = keys.filter(key => !VERIFIER_KEYS.has(key))
  if (unknown.length) return { name: 'verifier_registry', status: 'fail', detail: `Unknown verifier route(s): ${unknown.join(', ')}` }
  return { name: 'verifier_registry', status: 'pass', detail: keys.map(key => `${key}=${verifiers[key]}`).join(', ') }
}

function ensurePipeline(rootDir: string) {
  const stateDir = activeRunContext(rootDir).pipelineDir
  mkdirSync(stateDir, { recursive: true })
  return stateDir
}

function normalizePhase(value: string | undefined): RunPhase {
  if (value && PHASE_ORDER.includes(value as RunPhase)) return value as RunPhase
  return 'classify'
}

function completedPhases(phase: RunPhase) {
  return PHASE_ORDER.slice(0, PHASE_ORDER.indexOf(phase) + 1)
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function readVerdict(outcome: Record<string, unknown> | null): Verdict {
  const verdict = String(outcome?.verdict ?? 'UNKNOWN')
  if (verdict === 'PROVEN' || verdict === 'NOT_PROVEN' || verdict === 'INCONCLUSIVE') return verdict
  return 'UNKNOWN'
}

function readEvents(rootDir: string): YallaRunEvent[] {
  const path = pipelineFile(rootDir, 'events.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line) as YallaRunEvent]
      } catch {
        return []
      }
    })
}

function listPipelineArtifacts(rootDir: string) {
  const stateDir = activeRunContext(rootDir).pipelineDir
  if (!existsSync(stateDir)) return []
  return listDirectoryFiles(stateDir)
}

function listDirectoryFiles(path: string) {
  if (!existsSync(path)) return []
  return readdirSync(path).filter(name => !name.startsWith('.') && name !== 'run.lock' && !name.endsWith('.tmp')).sort()
}

function listCheckpoints(rootDir: string) {
  const checkpointsDir = pipelineFile(rootDir, 'checkpoints')
  if (!existsSync(checkpointsDir)) return []
  return readdirSync(checkpointsDir).sort().map(name => resolve(checkpointsDir, name))
}

function nextAction(phase: string, verdict: Verdict) {
  if (verdict === 'PROVEN') return 'Open or update the PR with the proof summary.'
  if (verdict === 'NOT_PROVEN') return 'Fix missing evidence or implementation gaps before shipping.'
  if (verdict === 'INCONCLUSIVE') return 'Ask for human or external evidence before calling the run complete.'
  const index = PHASE_ORDER.indexOf(phase as RunPhase)
  if (index >= 0 && index < PHASE_ORDER.length - 1) return `Continue to ${PHASE_ORDER[index + 1]}.`
  return 'Run classification or inspect missing artifacts.'
}

function buildTelemetry(events: YallaRunEvent[]) {
  const timestamps = events.map(event => Date.parse(event.ts)).filter(value => Number.isFinite(value)).sort((a, b) => a - b)
  const phaseCounts = new Map<string, number>()
  const eventCounts = new Map<string, number>()
  for (const event of events) {
    if (event.phase) phaseCounts.set(event.phase, (phaseCounts.get(event.phase) ?? 0) + 1)
    eventCounts.set(event.event, (eventCounts.get(event.event) ?? 0) + 1)
  }
  return {
    duration_seconds: timestamps.length >= 2 ? Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / 1000) : null,
    phase_event_counts: Object.fromEntries([...phaseCounts.entries()].sort()),
    event_counts: Object.fromEntries([...eventCounts.entries()].sort()),
  }
}

function budgetState(loadedConfig: LoadedYallaConfig, events: YallaRunEvent[]) {
  const maxIterations = loadedConfig.config.autopilot.maxIterations ?? 3
  const maxRuntimeMinutes = loadedConfig.config.autopilot.maxRuntimeMinutes ?? 45
  const telemetry = buildTelemetry(events)
  const iterationsUsed = events.filter(event => event.event === 'loop.evaluated').length
  const runtimeMinutesUsed = typeof telemetry.duration_seconds === 'number' ? Math.round(telemetry.duration_seconds / 60) : 0
  return {
    max_iterations: maxIterations,
    iterations_used: iterationsUsed,
    iterations_remaining: Math.max(0, maxIterations - iterationsUsed),
    max_runtime_minutes: maxRuntimeMinutes,
    runtime_minutes_used: runtimeMinutesUsed,
    runtime_minutes_remaining: Math.max(0, maxRuntimeMinutes - runtimeMinutesUsed),
    token_budget: loadedConfig.config.autopilot.tokenBudget ?? 'repo-defined',
    exhausted: iterationsUsed >= maxIterations || runtimeMinutesUsed >= maxRuntimeMinutes,
  }
}

function budgetFromGoal(goal: Record<string, unknown> | null, events: YallaRunEvent[]) {
  const budget = goal?.budget as Record<string, unknown> | undefined
  const maxIterations = Number(budget?.max_iterations ?? 3)
  const maxRuntimeMinutes = Number(budget?.max_runtime_minutes ?? 45)
  const telemetry = buildTelemetry(events)
  const iterationsUsed = events.filter(event => event.event === 'loop.evaluated').length
  const runtimeMinutesUsed = typeof telemetry.duration_seconds === 'number' ? Math.round(telemetry.duration_seconds / 60) : 0
  return {
    max_iterations: Number.isFinite(maxIterations) ? maxIterations : 3,
    iterations_used: iterationsUsed,
    iterations_remaining: Math.max(0, (Number.isFinite(maxIterations) ? maxIterations : 3) - iterationsUsed),
    max_runtime_minutes: Number.isFinite(maxRuntimeMinutes) ? maxRuntimeMinutes : 45,
    runtime_minutes_used: runtimeMinutesUsed,
    runtime_minutes_remaining: Math.max(0, (Number.isFinite(maxRuntimeMinutes) ? maxRuntimeMinutes : 45) - runtimeMinutesUsed),
    token_budget: budget?.token_budget ?? 'repo-defined',
    exhausted: iterationsUsed >= (Number.isFinite(maxIterations) ? maxIterations : 3) || runtimeMinutesUsed >= (Number.isFinite(maxRuntimeMinutes) ? maxRuntimeMinutes : 45),
  }
}

function cleanList(values: string[] | undefined) {
  return (values ?? []).map(value => value.trim()).filter(Boolean)
}

function validateProofArtifact(target: string, document: Record<string, unknown>, rootDir: string, candidate: CandidateIdentity) {
  if (document.issue_id !== undefined && document.issue_id !== candidate.issue_id) {
    return `Cannot bind ${target}; issue_id does not match the active candidate.`
  }
  if (target === 'classification.json') {
    const classificationError = validateClassificationDecisions(document)
    if (classificationError) return classificationError
  }
  if (target === 'acceptance-trace.json') {
    const criteria = Array.isArray(document.criteria) ? document.criteria as Array<Record<string, unknown>> : []
    if (!criteria.length) return 'Acceptance trace requires at least one criterion.'
  }
  if (target === 'test-evidence.json') {
    const commands = Array.isArray(document.commands) ? document.commands : []
    if (!commands.length) return 'Test evidence requires at least one command result.'
  }
  if (target === 'review-results.json') {
    const checks = Array.isArray(document.checks) ? document.checks : []
    if (!checks.length) return 'Review results require at least one binary check.'
  }
  if (target !== 'outcome-evaluation.json') return undefined

  if (document.issue_id !== candidate.issue_id || !candidate.issue_id) return 'PROVEN outcome requires the active candidate issue_id.'
  const verdict = String(document.verdict ?? '')
  if (!['PROVEN', 'NOT_PROVEN', 'INCONCLUSIVE'].includes(verdict)) return 'Outcome verdict must be PROVEN, NOT_PROVEN, or INCONCLUSIVE.'
  if (verdict !== 'PROVEN') return undefined

  const acceptance = readJson(pipelineFile(rootDir, 'acceptance-trace.json'))
  const criteria = Array.isArray(acceptance?.criteria) ? acceptance.criteria as Array<Record<string, unknown>> : []
  if (!criteria.length || criteria.some(criterion => criterion.status !== 'covered' || !String(criterion.evidence ?? '').trim() || criterion.proof_mode === 'inconclusive')) {
    return 'PROVEN requires every acceptance criterion to be covered by non-inconclusive evidence.'
  }
  if (!criteria.some(criterion => criterion.proof_mode !== 'model-judge' && criterion.proof_mode !== 'inconclusive')) {
    return 'PROVEN requires at least one deterministic acceptance proof.'
  }
  if (criteria.some(criterion => {
    const boundary = criterion.boundary_proof as Record<string, unknown> | undefined
    return boundary?.required === true && boundary.status !== 'covered'
  })) return 'PROVEN requires every mandatory boundary proof to be covered.'

  const goal = readJson(pipelineFile(rootDir, 'goal-contract.json'))
  const goalCriteria = Array.isArray(goal?.success_criteria) ? goal.success_criteria.map(value => normalizeProofLabel(value)) : []
  const acceptanceNames = criteria.map(criterion => normalizeProofLabel(criterion.criterion ?? criterion.description))
  if (!goalCriteria.length || JSON.stringify([...new Set(goalCriteria)].sort()) !== JSON.stringify([...new Set(acceptanceNames)].sort())) {
    return 'PROVEN acceptance trace must cover the exact goal-contract success criteria.'
  }

  const testEvidence = readJson(pipelineFile(rootDir, 'test-evidence.json'))
  const commands = Array.isArray(testEvidence?.commands) ? testEvidence.commands as Array<Record<string, unknown>> : []
  if (!commands.length || commands.some(command => command.status !== 'pass')) return 'PROVEN requires every required command to pass.'
  const requiredEvidence = Array.isArray(goal?.required_evidence) ? goal.required_evidence.map(value => normalizeProofLabel(value)) : []
  const commandNames = commands.map(command => normalizeProofLabel(command.command))
  if (requiredEvidence.some(required => !commandNames.includes(required))) return 'PROVEN test evidence must include every goal-contract required evidence command.'
  const claims = Array.isArray(testEvidence?.claim_verification) ? testEvidence.claim_verification as Array<Record<string, unknown>> : []
  if (claims.some(claim => claim.verdict !== 'VERIFIED')) return 'PROVEN cannot include an unverified or inconclusive claim.'
  const smoke = Array.isArray(testEvidence?.smoke_evidence) ? testEvidence.smoke_evidence as Array<Record<string, unknown>> : []
  if (smoke.some(item => item.status !== 'pass')) return 'PROVEN cannot include failed or blocked smoke evidence.'
  const ci = testEvidence?.ci_evidence as Record<string, unknown> | undefined
  if (ci && !['pass', 'n/a'].includes(String(ci.status))) return 'PROVEN requires passing or explicitly non-applicable CI evidence.'

  const review = readJson(pipelineFile(rootDir, 'review-results.json'))
  const checks = Array.isArray(review?.checks) ? review.checks as Array<Record<string, unknown>> : []
  if (!checks.length || checks.some(check => String(check.verdict ?? check.status ?? '').toLowerCase() !== 'pass')) {
    return 'PROVEN requires every required review check to pass.'
  }
  const classification = readJson(pipelineFile(rootDir, 'classification.json'))
  const classificationError = validateClassificationDecisions(classification ?? {})
  if (classificationError) return `PROVEN requires a valid persisted classification: ${classificationError}`
  const requiredGates = Array.isArray(classification?.required_gates) ? classification.required_gates.map(value => String(value)) : []
  const requiredChecks = Array.isArray(review?.required_checks) ? review.required_checks.map(value => String(value)) : []
  const checkNames = checks.map(check => String(check.name ?? ''))
  if (!requiredGates.length || requiredGates.some(gate => !requiredChecks.includes(gate))) return 'PROVEN review required_checks must retain every classification required_gate.'
  if (requiredChecks.some(check => !checkNames.includes(check))) return 'PROVEN review results are missing one or more required_checks.'
  const evidenceGates = review?.evidence_gates as Record<string, unknown> | undefined
  if (!evidenceGates || PORTABLE_GATE_BINDINGS.some(binding => !evidenceGates[binding.evidenceField])) {
    return 'PROVEN requires an applicable or concrete N/A review decision for every portable evidence gate.'
  }
  const gateViolations = validateEvidenceGates(evidenceGates, { requireReadyForProven: true })
  if (gateViolations.length) return `PROVEN portable evidence gates are not ready: ${gateViolations.map(violation => `${violation.path}: ${violation.message}`).join('; ')}`
  for (const binding of PORTABLE_GATE_BINDINGS) {
    const decision = classificationGateDecision(classification ?? {}, binding)
    const evidence = evidenceGates[binding.evidenceField] as Record<string, unknown>
    if (decision.status === 'applies' && (!requiredGates.includes(binding.reviewCheck) || evidence.applies !== true)) {
      return `PROVEN requires ${binding.reviewCheck} and applicable ${binding.evidenceField} evidence because classification armed that gate.`
    }
    if (decision.status === 'n/a' && evidence.applies !== false) {
      return `PROVEN portable gate ${binding.evidenceField} must preserve the classification N/A decision.`
    }
  }
  const criteriaSummary = Array.isArray(document.criteria_summary) ? document.criteria_summary as Array<Record<string, unknown>> : []
  if (!criteriaSummary.length || criteriaSummary.some(criterion => criterion.status !== 'covered' || !String(criterion.evidence ?? '').trim())) {
    return 'PROVEN outcome requires a covered criteria_summary with evidence.'
  }
  const acceptanceSummaryNames = criteria.map(criterion => String(criterion.criterion ?? criterion.description ?? '')).sort()
  const summaryNames = criteriaSummary.map(criterion => String(criterion.criterion ?? '')).sort()
  if (JSON.stringify(acceptanceSummaryNames) !== JSON.stringify(summaryNames)) return 'PROVEN criteria_summary must cover the exact acceptance trace.'
  if ((Array.isArray(document.remaining_delta) && document.remaining_delta.length) || (Array.isArray(document.human_decisions_needed) && document.human_decisions_needed.length)) {
    return 'PROVEN outcome cannot have remaining delta or pending human decisions.'
  }
  return undefined
}

function normalizeProofLabel(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function classificationGateDecision(classification: Record<string, unknown>, binding: (typeof PORTABLE_GATE_BINDINGS)[number]) {
  if (binding.classificationField === 'external_grounding_gate' || binding.classificationField === 'runtime_e2e_gate') {
    return {
      status: String(classification[binding.classificationField] ?? ''),
      reason: String(classification[binding.reasonField] ?? '').trim(),
    }
  }
  const requirements = classification.evidence_gate_requirements as Record<string, Record<string, unknown>> | undefined
  const decision = requirements?.[binding.classificationField]
  return { status: String(decision?.status ?? ''), reason: String(decision?.reason ?? '').trim() }
}

function validateClassificationDecisions(classification: Record<string, unknown>) {
  const requiredGates = Array.isArray(classification.required_gates) ? classification.required_gates.map(value => String(value)) : []
  if (!requiredGates.length) return 'Classification requires non-empty required_gates.'
  for (const binding of PORTABLE_GATE_BINDINGS) {
    const decision = classificationGateDecision(classification, binding)
    if (!['applies', 'n/a'].includes(decision.status) || !decision.reason) return `Classification requires ${binding.evidenceField} as applies or n/a with a concrete reason.`
    if (decision.status === 'applies' && !requiredGates.includes(binding.reviewCheck)) return `Classification must add ${binding.reviewCheck} when ${binding.evidenceField} applies.`
  }
  return undefined
}

function normalizeEvaluatorVerdict(value: string | undefined) {
  const upper = String(value ?? 'INCONCLUSIVE').toUpperCase()
  if (upper === 'PASS' || upper === 'FAIL' || upper === 'INCONCLUSIVE') return upper
  return 'INCONCLUSIVE'
}

function evaluatorNextInstruction(verdict: string) {
  if (verdict === 'PASS') return 'Proceed to the next phase or final proof evaluation.'
  if (verdict === 'FAIL') return 'Fix the evaluator findings before continuing.'
  return 'Collect stronger evidence or ask for human judgment before continuing.'
}

function loopDecision(status: Record<string, unknown>, latestEvaluator?: Record<string, unknown>): LoopDecision {
  const budget = status.budget as { exhausted?: boolean } | undefined
  if (budget?.exhausted) return 'stop-budget'
  if (status.candidate_state === 'SUPERSEDED') return 'stop-superseded'
  if (status.candidate_state === 'UNBOUND') return 'stop-identity'
  if (status.candidate_state === 'IDENTITY_MISMATCH' || status.candidate_state === 'INCOMPATIBLE_SCHEMA') return 'stop-identity'
  if (status.candidate_state === 'RESUMABLE_AFTER_REVALIDATION') return 'stop-identity'
  if (status.verdict === 'PROVEN') return 'stop-proven'
  if (status.verdict === 'INCONCLUSIVE') return 'stop-inconclusive'
  if (latestEvaluator?.verdict === 'FAIL') {
    const failureClass = normalizeFailureClass(String(latestEvaluator.failure_class ?? '')) ?? 'CANDIDATE_FAILURE'
    if (failureClass === 'BASELINE_FAILURE') return 'stop-baseline'
    if (failureClass === 'INFRA_ERROR') return 'retry-infra'
    if (failureClass === 'IDENTITY_MISMATCH') return 'stop-identity'
    if (failureClass === 'POLICY_BLOCKED') return 'stop-policy'
    if (failureClass === 'SUPERSEDED') return 'stop-superseded'
    return 'continue'
  }
  if (latestEvaluator?.verdict === 'INCONCLUSIVE') return 'stop-inconclusive'
  if (!status.goal_contract) return 'blocked'
  return 'continue'
}

function loopInstruction(decision: LoopDecision, status: Record<string, unknown>, latestEvaluator?: Record<string, unknown>) {
  if (decision === 'stop-proven') return 'Stop: proof contract is PROVEN. Prepare PR summary/export.'
  if (decision === 'stop-inconclusive') return 'Stop: evidence is inconclusive. Ask for human or external verifier input.'
  if (decision === 'stop-budget') return 'Stop: loop budget exhausted. Summarize remaining delta and ask for direction.'
  if (decision === 'stop-baseline') return 'Stop: failure belongs to the inherited baseline. Open or link a separate baseline repair; do not widen this candidate.'
  if (decision === 'retry-infra') return 'Stop this attempt: infrastructure failed. Retry the same immutable candidate within the configured retry budget.'
  if (decision === 'stop-identity') return `Stop: candidate identity or policy changed (${String(status.candidate_state ?? 'unknown')}). Revalidate and mint a new candidate before reusing proof.`
  if (decision === 'stop-policy') return 'Stop: required capability is not granted. Obtain explicit authority or narrow the action.'
  if (decision === 'stop-superseded') return 'Stop: this candidate or evaluator result is superseded. Discard its proof and use the current candidate.'
  if (decision === 'blocked') return `Create ${String(status.pipeline_dir ?? '.pipeline')}/goal-contract.json before starting the loop.`
  if (latestEvaluator?.next_instruction) return String(latestEvaluator.next_instruction)
  return `Continue from phase ${String(status.phase ?? 'unknown')} and collect missing verifier evidence.`
}

function candidateValidationOptions(rootDir: string, loadedConfig: LoadedYallaConfig | undefined, candidate: CandidateIdentity) {
  return {
    rootDir,
    repository: loadedConfig?.config.repo ?? candidate.declared_repository,
    baseBranch: loadedConfig?.config.baseBranch ?? candidate.base_branch,
    configPath: loadedConfig?.path,
    releaseAdapterPath: loadedConfig?.config.releaseAdapterPath,
    pipelineDir: activeRunContext(rootDir).pipelineDir,
  }
}

function requireExactCandidate(rootDir: string, loadedConfig: LoadedYallaConfig) {
  const candidate = readCandidate(rootDir, activeRunContext(rootDir).pipelineDir)
  if (!candidate) {
    const context = activeRunContext(rootDir)
    const goal = readJson(resolve(context.pipelineDir, 'goal-contract.json'))
    return {
      candidate: null,
      instruction: `No active candidate. Run \`npm run yalla:run -- candidate --pipeline-dir ${context.pipelinePath} --issue-id ${String(goal?.issue_id ?? '<issue-id>')} --run-id ${String(goal?.run_id ?? '<run-id>')}\` first.`,
    }
  }
  const validation = validateCandidate(candidate, candidateValidationOptions(rootDir, loadedConfig, candidate))
  if (validation.state !== 'RESUMABLE_EXACT') return { candidate: null, instruction: `${validation.state}: ${validation.reasons.join('; ')}` }
  return { candidate, instruction: '' }
}

function isRemoteJobKind(value: string | undefined): value is RemoteJob['kind'] {
  return value === 'focused-check' || value === 'full-suite' || value === 'preview-build' || value === 'production-build' || value === 'smoke'
}

function isArtifactAction(value: string | undefined): value is RemoteJob['artifact_action'] {
  return value === 'built' || value === 'reused'
}

function isOperationStatus(value: string | undefined): value is 'pending' | 'succeeded' | 'failed' {
  return value === 'pending' || value === 'succeeded' || value === 'failed'
}

function isJobStatus(value: string | undefined): value is 'reserve' | 'succeeded' | 'failed' {
  return value === 'reserve' || value === 'succeeded' || value === 'failed'
}

function repeatedEventSummary(events: YallaRunEvent[]) {
  const counts = new Map<string, number>()
  for (const event of events) counts.set(event.event, (counts.get(event.event) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event))
}

function suggestedSessionUpdates(events: YallaRunEvent[], failedCommands: Array<Record<string, unknown>>, failedReviews: Array<Record<string, unknown>>) {
  const suggestions: Array<{ target: string; reason: string; suggested_text: string }> = []
  if (failedCommands.length) {
    suggestions.push({ target: '.claude/YALLA.md gotchas', reason: 'Repeated or failed command evidence found', suggested_text: 'Add a gotcha that names the failing command and the precondition required before running it.' })
  }
  if (failedReviews.length) {
    suggestions.push({ target: 'knowledge/yalla/PROJECT-CHECKS.md', reason: 'Review failures found', suggested_text: 'Promote the recurring review failure into a binary project check.' })
  }
  if (events.some(event => event.event.includes('inconclusive'))) {
    suggestions.push({ target: 'eval/yalla/data', reason: 'Inconclusive run state appeared', suggested_text: 'Add an eval fixture that prevents this inconclusive evidence gap from being counted as success.' })
  }
  return suggestions
}

function renderReport(rootDir: string, loadedConfig: LoadedYallaConfig, status: Record<string, unknown>, events: YallaRunEvent[]) {
  const eventRows = events.slice(-50).map(event => `<tr><td>${escapeHtml(event.ts)}</td><td>${escapeHtml(event.event)}</td><td>${escapeHtml(event.phase ?? '')}</td><td>${escapeHtml(String(event.properties.message ?? ''))}</td></tr>`).join('')
  const artifacts = Array.isArray(status.artifacts) ? status.artifacts as string[] : []
  const completed = new Set(Array.isArray(status.completed_phases) ? status.completed_phases as string[] : [])
  const goal = readJson(pipelineFile(rootDir, 'goal-contract.json'))
  const evaluator = readJson(pipelineFile(rootDir, 'evaluator-results.json'))
  const benchmarks = readJson(pipelineFile(rootDir, 'benchmarks.json'))
  const visualEvidence = listVisualEvidence(rootDir)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Yalla Run Report</title>
  <style>
    :root { --ink:#111; --paper:#f6f2e8; --accent:#ff5a1f; --line:#111; --ok:#0f7b3f; --warn:#b26a00; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font-family:ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width:1120px; margin:0 auto; padding:32px 20px 52px; }
    .hero, .card { border:3px solid var(--line); background:#fff; box-shadow:7px 7px 0 var(--line); padding:22px; }
    h1 { margin:0; font-size:clamp(34px, 7vw, 76px); line-height:.9; letter-spacing:-0.06em; text-transform:uppercase; }
    h2 { margin:0 0 12px; text-transform:uppercase; letter-spacing:-0.03em; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:18px; margin-top:24px; }
    .metric { font-size:42px; font-weight:950; letter-spacing:-0.05em; }
    .flow { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; }
    .phase { border:2px solid var(--line); padding:10px; text-align:center; font-weight:900; text-transform:uppercase; background:#eee; }
    .phase.done { background:#d7f5df; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { border:2px solid var(--line); padding:9px; text-align:left; vertical-align:top; }
    th { background:#111; color:#fff; text-transform:uppercase; }
    code, pre { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    pre { background:#111; color:#fff; padding:14px; border:2px solid var(--line); white-space:pre-wrap; overflow:auto; }
  </style>
</head>
<body>
<main>
  <section class="hero">
    <h1>Yalla Run Report</h1>
    <p>Local evidence dashboard generated from <code>${escapeHtml(activeRunContext(rootDir).pipelinePath)}/*</code>. It is safe to share in a PR when it contains no secrets.</p>
    <p><strong>Root:</strong> ${escapeHtml(rootDir)}</p>
    <p><strong>Config:</strong> ${escapeHtml(loadedConfig.path ?? 'missing')}</p>
  </section>
  <section class="grid">
    <div class="card"><h2>Phase</h2><div class="metric">${escapeHtml(String(status.phase))}</div></div>
    <div class="card"><h2>Verdict</h2><div class="metric">${escapeHtml(String(status.verdict))}</div></div>
    <div class="card"><h2>Events</h2><div class="metric">${events.length}</div></div>
    <div class="card"><h2>Artifacts</h2><div class="metric">${artifacts.length}</div></div>
  </section>
  <section class="card" style="margin-top:24px"><h2>Next Action</h2><pre>${escapeHtml(String(status.next_action))}</pre></section>
  <section class="card" style="margin-top:24px"><h2>Pipeline Graph</h2><div class="flow">${PHASE_ORDER.map(phase => `<div class="phase ${completed.has(phase) ? 'done' : ''}">${escapeHtml(phase)}</div>`).join('')}</div></section>
  <section class="card" style="margin-top:24px"><h2>Goal Contract</h2><pre>${escapeHtml(goal ? JSON.stringify(goal, null, 2) : 'No goal contract recorded yet.')}</pre></section>
  <section class="card" style="margin-top:24px"><h2>Evaluator Results</h2><pre>${escapeHtml(evaluator ? JSON.stringify(evaluator, null, 2) : 'No evaluator results recorded yet.')}</pre></section>
  <section class="card" style="margin-top:24px"><h2>Visual Evidence</h2>${renderVisualEvidence(visualEvidence)}</section>
  <section class="card" style="margin-top:24px"><h2>Benchmarks</h2><pre>${escapeHtml(benchmarks ? JSON.stringify(benchmarks, null, 2) : 'No benchmark artifact recorded yet.')}</pre></section>
  <section class="card" style="margin-top:24px"><h2>Status JSON</h2><pre>${escapeHtml(JSON.stringify(status, null, 2))}</pre></section>
  <section class="card" style="margin-top:24px"><h2>Recent Events</h2><table><thead><tr><th>Time</th><th>Event</th><th>Phase</th><th>Message</th></tr></thead><tbody>${eventRows || '<tr><td colspan="4">No events recorded yet.</td></tr>'}</tbody></table></section>
</main>
</body>
</html>
`
}

function listVisualEvidence(rootDir: string) {
  const dir = pipelineFile(rootDir, 'visual-evidence')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(name))
    .sort()
    .map(name => ({ name, path: `${activeRunContext(rootDir).pipelinePath}/visual-evidence/${name}` }))
}

function renderVisualEvidence(items: Array<{ name: string; path: string }>) {
  if (!items.length) return '<p>No visual evidence recorded yet.</p>'
  return `<div class="grid">${items.map(item => `<figure><img src="visual-evidence/${escapeHtml(item.name)}" alt="${escapeHtml(item.name)}" style="max-width:100%;border:2px solid var(--line)" /><figcaption><code>${escapeHtml(item.path)}</code></figcaption></figure>`).join('')}</div>`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char))
}

async function main() {
  const result = await runYallaRun(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = result.exitCode
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
