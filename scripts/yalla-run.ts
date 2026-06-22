#!/usr/bin/env tsx

import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'
import { loadYallaConfig, type LoadedYallaConfig } from './yalla-config.js'

const execFileAsync = promisify(execFile)

type RunPhase = 'classify' | 'track' | 'plan' | 'work' | 'test' | 'review' | 'compound' | 'ship'
type Verdict = 'PROVEN' | 'NOT_PROVEN' | 'INCONCLUSIVE' | 'UNKNOWN'
type CommandResult = { stdout: string; stderr: string; exitCode: number }
type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>
type LoopDecision = 'continue' | 'stop-proven' | 'stop-inconclusive' | 'stop-budget' | 'blocked'

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
  command: 'event' | 'checkpoint' | 'status' | 'report' | 'doctor' | 'resume' | 'rewind' | 'export' | 'goal' | 'evaluate' | 'loop' | 'mine-sessions'
  rootDir?: string
  configPath?: string
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
  commandRunner?: CommandRunner
  now?: () => string
}

export type YallaRunResult = {
  exitCode: number
  eventPath?: string
  checkpointPath?: string
  status?: Record<string, unknown>
  reportPath?: string
  exportPath?: string
  goalPath?: string
  evaluatorPath?: string
  loopPath?: string
  miningPath?: string
  checks?: Check[]
  instruction?: string
}

const PHASE_ORDER: RunPhase[] = ['classify', 'track', 'plan', 'work', 'test', 'review', 'compound', 'ship']
const MODEL_KEYS = new Set(['classify', 'plan', 'implement', 'test', 'review', 'summarize'])
const VERIFIER_KEYS = new Set(['api', 'ui', 'perf', 'docs', 'research', 'visual', 'benchmark', 'security', 'accessibility'])

function parseArgs(argv: string[]): RunOptions {
  const command = argv[0]
  if (!isCommand(command)) throw new Error('Usage: tsx scripts/yalla-run.ts event|checkpoint|status|report|doctor|resume|rewind|export|goal|evaluate|loop|mine-sessions [--config path] [--phase name] [--event name] [--message text] [--target checkpoint] [--run-id id]')

  const options: RunOptions = { command, criteria: [], constraint: [], evidence: [], forbiddenShortcut: [], finding: [] }
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--config') options.configPath = argv[++index] ?? ''
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
    else throw new Error(`Unknown arg: ${arg}`)
  }
  return options
}

function isCommand(value: string | undefined): value is RunOptions['command'] {
  return value === 'event' || value === 'checkpoint' || value === 'status' || value === 'report' || value === 'doctor' || value === 'resume' || value === 'rewind' || value === 'export' || value === 'goal' || value === 'evaluate' || value === 'loop' || value === 'mine-sessions'
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

  if (options.command === 'event') return recordEvent(rootDir, options, now)
  if (options.command === 'checkpoint') return writeCheckpoint(rootDir, options, now)
  if (options.command === 'status') return readStatus(rootDir)
  if (options.command === 'report') return writeReport(rootDir, loadedConfig)
  if (options.command === 'doctor') return runDoctor(rootDir, loadedConfig, commandRunner)
  if (options.command === 'resume') return resumeInstruction(rootDir)
  if (options.command === 'rewind') return rewindInstruction(rootDir, options.target)
  if (options.command === 'export') return exportBundle(rootDir)
  if (options.command === 'goal') return writeGoalContract(rootDir, loadedConfig, options, now)
  if (options.command === 'evaluate') return writeEvaluatorResult(rootDir, options, now)
  if (options.command === 'loop') return writeLoopState(rootDir, loadedConfig, now)
  return writeSessionMiningReport(rootDir, now)
}

function recordEvent(rootDir: string, options: RunOptions, now: () => string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const path = resolve(pipelineDir, 'events.jsonl')
  const event: YallaRunEvent = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: now(),
    event: options.event || 'run.note',
    phase: options.phase,
    run_id: options.runId,
    properties: { message: options.message ?? '' },
  }
  writeFileSync(path, `${JSON.stringify(event)}\n`, { flag: 'a' })
  return { exitCode: 0, eventPath: path, status: event as unknown as Record<string, unknown> }
}

function writeCheckpoint(rootDir: string, options: RunOptions, now: () => string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const checkpointsDir = resolve(pipelineDir, 'checkpoints')
  mkdirSync(checkpointsDir, { recursive: true })
  const phase = normalizePhase(options.phase)
  const status = buildStatus(rootDir)
  const checkpoint = {
    ts: now(),
    phase,
    run_id: options.runId,
    message: options.message ?? '',
    verdict: status.verdict,
    completed_phases: completedPhases(phase),
    artifacts: listPipelineArtifacts(rootDir),
  }
  const path = resolve(checkpointsDir, `${String(Date.now())}-${phase}.json`)
  writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`)
  writeFileSync(resolve(pipelineDir, 'latest-checkpoint.json'), `${JSON.stringify({ ...checkpoint, path }, null, 2)}\n`)
  recordEvent(rootDir, { ...options, command: 'event', event: 'checkpoint.completed', message: options.message }, now)
  return { exitCode: 0, checkpointPath: path, status: checkpoint }
}

function readStatus(rootDir: string): YallaRunResult {
  return { exitCode: 0, status: buildStatus(rootDir) }
}

function buildStatus(rootDir: string, loadedConfig?: LoadedYallaConfig) {
  const latest = readJson(resolve(rootDir, '.pipeline/latest-checkpoint.json'))
  const classification = readJson(resolve(rootDir, '.pipeline/classification.json'))
  const outcome = readJson(resolve(rootDir, '.pipeline/outcome-evaluation.json'))
  const acceptance = readJson(resolve(rootDir, '.pipeline/acceptance-trace.json'))
  const review = readJson(resolve(rootDir, '.pipeline/review-results.json'))
  const goal = readJson(resolve(rootDir, '.pipeline/goal-contract.json'))
  const evaluator = readJson(resolve(rootDir, '.pipeline/evaluator-results.json'))
  const events = readEvents(rootDir)
  const telemetry = buildTelemetry(events)
  const phase = String(latest?.phase ?? classification?.phase ?? 'unknown')
  const verdict = readVerdict(outcome)
  const budget = loadedConfig ? budgetState(loadedConfig, events) : budgetFromGoal(goal, events)
  return {
    phase,
    verdict,
    latest_checkpoint: latest?.path ?? null,
    completed_phases: latest?.completed_phases ?? [],
    artifacts: listPipelineArtifacts(rootDir),
    acceptance_criteria: Array.isArray(acceptance?.criteria) ? acceptance.criteria.length : null,
    review_checks: Array.isArray(review?.checks) ? review.checks.length : null,
    goal_contract: Boolean(goal),
    evaluator_results: Array.isArray(evaluator?.results) ? evaluator.results.length : null,
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
  writeFileSync(path, renderReport(rootDir, loadedConfig, status, events))
  return { exitCode: 0, reportPath: path, status }
}

async function runDoctor(rootDir: string, loadedConfig: LoadedYallaConfig, commandRunner: CommandRunner): Promise<YallaRunResult> {
  const config = loadedConfig.config
  const checks: Check[] = []
  checks.push({ name: 'config', status: loadedConfig.path ? 'pass' : 'fail', detail: loadedConfig.path ?? 'Missing .claude/YALLA.md or --config path' })
  checks.push({ name: 'base_branch', status: config.baseBranch ? 'pass' : 'fail', detail: config.baseBranch ?? 'Missing base_branch' })
  checks.push({ name: 'commands.test', status: config.commands.test ? 'pass' : 'fail', detail: config.commands.test ?? 'Missing test command' })
  checks.push({ name: 'commands.typecheck', status: config.commands.typecheck !== undefined ? 'pass' : 'warn', detail: config.commands.typecheck ?? 'Missing typecheck command or explicit empty string' })
  checks.push({ name: 'test_dir', status: config.testDir && existsSync(resolve(rootDir, config.testDir)) ? 'pass' : 'warn', detail: config.testDir ?? 'Missing test_dir' })
  checks.push(modelRoutingCheck(config.models))
  checks.push(verifierRegistryCheck(config.verifiers))
  const git = await commandRunner('git', ['rev-parse', '--is-inside-work-tree'])
  checks.push({ name: 'git_repo', status: git.exitCode === 0 ? 'pass' : 'fail', detail: git.exitCode === 0 ? 'Git repository detected' : 'Not inside a Git repository' })
  const gh = await commandRunner('gh', ['auth', 'status'])
  checks.push({ name: 'github_auth', status: gh.exitCode === 0 ? 'pass' : 'warn', detail: gh.exitCode === 0 ? 'gh authenticated' : 'gh unavailable or unauthenticated' })
  checks.push({ name: 'pipeline_dir', status: existsSync(resolve(rootDir, '.pipeline')) ? 'pass' : 'warn', detail: existsSync(resolve(rootDir, '.pipeline')) ? '.pipeline exists' : '.pipeline will be created on first run event' })
  const hasFailure = checks.some(check => check.status === 'fail')
  return { exitCode: hasFailure ? 1 : 0, checks }
}

function resumeInstruction(rootDir: string): YallaRunResult {
  const status = buildStatus(rootDir)
  const latest = status.latest_checkpoint ? String(status.latest_checkpoint) : ''
  const instruction = latest
    ? `Resume from ${latest}. Continue with next action: ${status.next_action}`
    : 'No checkpoint found. Start with classification, then create a checkpoint with `npm run yalla:run -- checkpoint --phase classify`.'
  return { exitCode: latest ? 0 : 1, status, instruction }
}

function rewindInstruction(rootDir: string, target?: string): YallaRunResult {
  const checkpoints = listCheckpoints(rootDir)
  if (!checkpoints.length) return { exitCode: 1, instruction: 'No checkpoints found in .pipeline/checkpoints.' }
  const selected = target ? checkpoints.find(path => basename(path).includes(target)) : checkpoints.at(-2) ?? checkpoints.at(0)
  if (!selected) return { exitCode: 1, instruction: `No checkpoint matched ${target}. Available: ${checkpoints.map(path => basename(path)).join(', ')}` }
  return {
    exitCode: 0,
    instruction: `Rewind target selected: ${selected}. Reset manually only after inspecting the diff; Yalla does not run destructive git commands automatically.`,
    checkpointPath: selected,
  }
}

function exportBundle(rootDir: string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const exportDir = resolve(pipelineDir, `export-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(exportDir, { recursive: true })
  for (const artifact of listPipelineArtifacts(rootDir)) {
    if (artifact.startsWith('export-')) continue
    const source = resolve(pipelineDir, artifact)
    if (!existsSync(source)) continue
    copyArtifact(source, resolve(exportDir, artifact))
  }
  writeFileSync(resolve(exportDir, 'status.json'), `${JSON.stringify(buildStatus(rootDir), null, 2)}\n`)
  return { exitCode: 0, exportPath: exportDir, status: { exported_artifacts: listDirectoryFilesRecursive(exportDir) } }
}

function writeGoalContract(rootDir: string, loadedConfig: LoadedYallaConfig, options: RunOptions, now: () => string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const path = resolve(pipelineDir, 'goal-contract.json')
  const budget = budgetState(loadedConfig, readEvents(rootDir))
  const contract = {
    version: 1,
    created_at: now(),
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
  writeFileSync(path, `${JSON.stringify(contract, null, 2)}\n`)
  recordEvent(rootDir, { ...options, command: 'event', event: 'goal.contract.created', phase: options.phase ?? 'classify', message: contract.desired_end_state }, now)
  return { exitCode: 0, goalPath: path, status: contract }
}

function writeEvaluatorResult(rootDir: string, options: RunOptions, now: () => string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const path = resolve(pipelineDir, 'evaluator-results.json')
  const existing = readJson(path)
  const results = Array.isArray(existing?.results) ? existing.results : []
  const verdict = normalizeEvaluatorVerdict(options.verdict)
  const result = {
    ts: now(),
    evaluator: options.evaluator || 'independent-evaluator',
    verdict,
    phase: options.phase ?? buildStatus(rootDir).phase,
    findings: cleanList(options.finding),
    next_instruction: options.message || evaluatorNextInstruction(verdict),
  }
  const document = { version: 1, results: [...results, result] }
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
  recordEvent(rootDir, { ...options, command: 'event', event: 'evaluator.completed', phase: result.phase, message: `${result.evaluator}: ${result.verdict}` }, now)
  return { exitCode: verdict === 'FAIL' ? 1 : 0, evaluatorPath: path, status: result }
}

function writeLoopState(rootDir: string, loadedConfig: LoadedYallaConfig, now: () => string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const path = resolve(pipelineDir, 'loop-state.json')
  const status = buildStatus(rootDir, loadedConfig)
  const goal = readJson(resolve(rootDir, '.pipeline/goal-contract.json'))
  const evaluator = readJson(resolve(rootDir, '.pipeline/evaluator-results.json'))
  const latestEvaluator = Array.isArray(evaluator?.results) ? evaluator.results.at(-1) as Record<string, unknown> | undefined : undefined
  const decision = loopDecision(status, latestEvaluator)
  const loopState = {
    ts: now(),
    decision,
    iteration: status.budget?.iterations_used ?? 0,
    budget: status.budget,
    goal_present: Boolean(goal),
    evaluator_verdict: latestEvaluator?.verdict ?? null,
    next_instruction: loopInstruction(decision, status, latestEvaluator),
  }
  writeFileSync(path, `${JSON.stringify(loopState, null, 2)}\n`)
  recordEvent(rootDir, { command: 'event', event: 'loop.evaluated', phase: String(status.phase ?? ''), message: `${decision}: ${loopState.next_instruction}` }, now)
  return { exitCode: decision === 'continue' ? 0 : decision === 'stop-proven' ? 0 : 1, loopPath: path, status: loopState }
}

function writeSessionMiningReport(rootDir: string, now: () => string): YallaRunResult {
  const pipelineDir = ensurePipeline(rootDir)
  const path = resolve(pipelineDir, 'session-mining-report.json')
  const events = readEvents(rootDir)
  const testEvidence = readJson(resolve(rootDir, '.pipeline/test-evidence.json'))
  const reviewResults = readJson(resolve(rootDir, '.pipeline/review-results.json'))
  const failedCommands = Array.isArray(testEvidence?.commands)
    ? (testEvidence.commands as Array<Record<string, unknown>>).filter(command => command.status && command.status !== 'pass')
    : []
  const failedReviews = Array.isArray(reviewResults?.checks)
    ? (reviewResults.checks as Array<Record<string, unknown>>).filter(check => check.verdict === 'FAIL' || check.status === 'fail')
    : []
  const report = {
    generated_at: now(),
    total_events: events.length,
    repeated_events: repeatedEventSummary(events),
    failed_commands: failedCommands,
    failed_reviews: failedReviews,
    blocker_patterns: events.filter(event => event.event.includes('blocked') || String(event.properties.message ?? '').toLowerCase().includes('blocked')),
    suggested_updates: suggestedSessionUpdates(events, failedCommands, failedReviews),
  }
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  recordEvent(rootDir, { command: 'event', event: 'sessions.mined', phase: 'compound', message: `${report.suggested_updates.length} suggested update(s)` }, now)
  return { exitCode: 0, miningPath: path, status: report }
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
  const pipelineDir = resolve(rootDir, '.pipeline')
  mkdirSync(pipelineDir, { recursive: true })
  return pipelineDir
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
  const path = resolve(rootDir, '.pipeline/events.jsonl')
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
  const pipelineDir = resolve(rootDir, '.pipeline')
  if (!existsSync(pipelineDir)) return []
  return listDirectoryFiles(pipelineDir)
}

function listDirectoryFiles(path: string) {
  if (!existsSync(path)) return []
  return readdirSync(path).filter(name => !name.startsWith('.')).sort()
}

function listDirectoryFilesRecursive(path: string, prefix = ''): string[] {
  if (!existsSync(path)) return []
  return readdirSync(path)
    .filter(name => !name.startsWith('.'))
    .sort()
    .flatMap(name => {
      const relative = prefix ? `${prefix}/${name}` : name
      const fullPath = resolve(path, name)
      if (statSync(fullPath).isDirectory()) return listDirectoryFilesRecursive(fullPath, relative)
      return [relative]
    })
}

function copyArtifact(source: string, destination: string) {
  if (statSync(source).isDirectory()) {
    mkdirSync(destination, { recursive: true })
    for (const name of readdirSync(source).filter(entry => !entry.startsWith('.'))) {
      copyArtifact(resolve(source, name), resolve(destination, name))
    }
    return
  }
  mkdirSync(resolve(destination, '..'), { recursive: true })
  copyFileSync(source, destination)
}

function listCheckpoints(rootDir: string) {
  const checkpointsDir = resolve(rootDir, '.pipeline/checkpoints')
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
  if (status.verdict === 'PROVEN') return 'stop-proven'
  if (status.verdict === 'INCONCLUSIVE') return 'stop-inconclusive'
  if (latestEvaluator?.verdict === 'FAIL') return 'continue'
  if (latestEvaluator?.verdict === 'INCONCLUSIVE') return 'stop-inconclusive'
  if (!status.goal_contract) return 'blocked'
  return 'continue'
}

function loopInstruction(decision: LoopDecision, status: Record<string, unknown>, latestEvaluator?: Record<string, unknown>) {
  if (decision === 'stop-proven') return 'Stop: proof contract is PROVEN. Prepare PR summary/export.'
  if (decision === 'stop-inconclusive') return 'Stop: evidence is inconclusive. Ask for human or external verifier input.'
  if (decision === 'stop-budget') return 'Stop: loop budget exhausted. Summarize remaining delta and ask for direction.'
  if (decision === 'blocked') return 'Create `.pipeline/goal-contract.json` before starting the loop.'
  if (latestEvaluator?.next_instruction) return String(latestEvaluator.next_instruction)
  return `Continue from phase ${String(status.phase ?? 'unknown')} and collect missing verifier evidence.`
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
  const goal = readJson(resolve(rootDir, '.pipeline/goal-contract.json'))
  const evaluator = readJson(resolve(rootDir, '.pipeline/evaluator-results.json'))
  const benchmarks = readJson(resolve(rootDir, '.pipeline/benchmarks.json'))
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
    <p>Local evidence dashboard generated from <code>.pipeline/*</code>. It is safe to share in a PR when it contains no secrets.</p>
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
  const dir = resolve(rootDir, '.pipeline/visual-evidence')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(name))
    .sort()
    .map(name => ({ name, path: `.pipeline/visual-evidence/${name}` }))
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
