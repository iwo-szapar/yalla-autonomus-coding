#!/usr/bin/env tsx

import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { loadYallaConfig } from './yalla-config.js'
import {
  CONTROL_SCHEMA_VERSION,
  YALLA_CONTROL_VERSION,
  acquireRunLock,
  atomicWriteJson,
  canonicalPipelineStateDir,
  releaseRunLock,
  requiredCapabilityForCommand,
  type Capability,
} from './yalla-control.js'

const execFileAsync = promisify(execFile)

// Genericized repo target.
//
// Resolution order (CLI entrypoint only):
//   1. `YALLA_REPO` environment variable, if set (e.g. "owner/repo").
//   2. `gh repo view --json nameWithOwner -q .nameWithOwner` against the cwd repo.
//   3. The documented placeholder below.
//
// The exported `runYallaAutopilot()` defaults to DEFAULT_REPO when no `repo`
// option is passed so callers (and tests) get deterministic behavior; the
// dynamic env/gh detection happens in `resolveRepo()` which `main()` calls.
// This is an inert placeholder — real runs pass an explicit `repo`, set
// YALLA_REPO, or rely on `gh repo view` auto-detection. It is intentionally
// not a real repository so a misconfigured run targets nothing.
const DEFAULT_REPO = 'OWNER/REPO'

type Mode = 'dry-run'
type Status = 'blocked' | 'dry-run-complete' | 'report-complete'

export type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>

export type AutopilotOptions = {
  issue: string
  mode: Mode
  repo?: string
  rootDir?: string
  commandRunner?: CommandRunner
  now?: () => string
}

export type AutopilotQueueOptions = {
  mode: Mode
  repo?: string
  rootDir?: string
  configPath?: string
  commandRunner?: CommandRunner
  now?: () => string
  eligibleLabels?: string[]
  blockLabels?: string[]
  limit?: number
}

export type AutopilotRunResult = {
  status: Status
  exitCode: number
  statePath: string
  telemetryPath: string
  reportPath?: string
}

type CommandRecord = CommandResult & {
  command: string
  args: string[]
}

type AutopilotState = {
  schema_version: number
  yalla_version: string
  issue_id: string
  mode: Mode
  phase: 'preflight' | 'issue-probe' | 'stopped'
  status: Status
  github_auth: 'pass' | 'fail'
  started_at: string
  completed_at: string
  stop_reason: string
  dry_run_side_effects_blocked: boolean
  lock_owner: string
  last_safe_checkpoint: string | null
  allowed_capabilities: Capability[]
  issue_url?: string
}

type LoopTelemetry = {
  schema_version: number
  yalla_version: string
  issue_id: string
  mode: Mode
  iterations_budget: number
  iterations_used: number
  started_at: string
  completed_at: string
  command_results: CommandRecord[]
  side_effects_attempted: string[]
}

type QueueIssue = {
  number: number
  title: string
  url?: string
  labels?: Array<{ name?: string } | string>
  createdAt?: string
  updatedAt?: string
}

type QueueReport = {
  mode: Mode
  repo: string
  eligible_labels: string[]
  block_labels: string[]
  selected_issue: string | null
  candidates: Array<{
    issue_id: string
    title: string
    url?: string
    labels: string[]
    score: number
  }>
  skipped: Array<{
    issue_id: string
    title: string
    reason: string
  }>
  generated_at: string
  config_path?: string
  config_source: string
}

/**
 * Resolve the target repo for the CLI entrypoint.
 * Used only by `main()`; the exported runner keeps the deterministic default.
 */
export function resolveRepo(): string {
  const fromEnv = process.env.YALLA_REPO?.trim()
  if (fromEnv) return fromEnv

  try {
    const detected = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
      encoding: 'utf8',
    }).trim()
    if (detected) return detected
  } catch {
    // gh unavailable or not inside a GitHub repo — fall back to the placeholder.
  }

  return DEFAULT_REPO
}

type CliOptions = ({ command: 'run' } & AutopilotOptions) | ({ command: 'queue' } & AutopilotQueueOptions)

function parseArgs(argv: string[]): CliOptions {
  if (argv[0] === 'run') return parseRunArgs(argv)
  if (argv[0] === 'queue') return parseQueueArgs(argv)
  throw new Error('Usage: tsx scripts/yalla-autopilot.ts run --issue issue-### --mode dry-run | queue --mode dry-run')
}

function parseRunArgs(argv: string[]): { command: 'run' } & AutopilotOptions {
  let issue = ''
  let mode: Mode = 'dry-run'
  let repo: string | undefined
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--issue') issue = argv[++index] ?? ''
    else if (arg === '--mode') mode = parseMode(argv[++index] ?? '')
    else if (arg === '--repo') repo = argv[++index] ?? ''
    else throw new Error(`Unknown arg: ${arg}`)
  }

  return { command: 'run', issue, mode, repo }
}

function parseQueueArgs(argv: string[]): { command: 'queue' } & AutopilotQueueOptions {
  let mode: Mode = 'dry-run'
  let repo: string | undefined
  const eligibleLabels: string[] = []
  const blockLabels: string[] = []
  let configPath: string | undefined
  let limit = 20

  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--mode') mode = parseMode(argv[++index] ?? '')
    else if (arg === '--repo') repo = argv[++index] ?? ''
    else if (arg === '--config') configPath = argv[++index] ?? ''
    else if (arg === '--label') eligibleLabels.push(argv[++index] ?? '')
    else if (arg === '--block-label') blockLabels.push(argv[++index] ?? '')
    else if (arg === '--limit') limit = Number(argv[++index] ?? limit)
    else throw new Error(`Unknown arg: ${arg}`)
  }

  return { command: 'queue', mode, repo, configPath, eligibleLabels, blockLabels, limit }
}

function parseMode(value: string): Mode {
  if (value === 'dry-run') return value
  throw new Error('Mode must be dry-run. Execute mode is out of scope for PRD 05.')
}

function issueNumber(issue: string): string {
  const match = issue.match(/^issue-(\d+)$/)
  if (!match) throw new Error('Issue must use canonical issue-### format.')
  return match[1]
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

function redactCommandResult(result: CommandResult): CommandResult {
  return {
    stdout: redactSecrets(result.stdout),
    stderr: redactSecrets(result.stderr),
    exitCode: result.exitCode,
  }
}

function redactSecrets(value: string) {
  return value
    .replace(/gh[opsu]_[A-Za-z0-9_]+/g, '<redacted-token>')
    .replace(/sbk_[A-Za-z0-9_]+/g, '<redacted-sbk-token>')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<redacted-jwt>')
}

export function isMutatingCommand(command: string, args: string[]) {
  const capability = requiredCapabilityForCommand(command, args)
  if (!capability) return undefined
  if (command === 'gh') return [command, ...args.slice(0, 2)].join(' ')
  return [command, args[0]].filter(Boolean).join(' ')
}

export { requiredCapabilityForCommand }

function assertDryRunSafe(command: string, args: string[]) {
  const mutatingCommand = isMutatingCommand(command, args)
  if (mutatingCommand) {
    throw new Error(`Dry-run blocked mutating command: ${mutatingCommand}`)
  }
}

function writeJson(rootDir: string, pipelineStateDir: string, name: string, value: unknown) {
  const pipelineDir = resolve(rootDir, pipelineStateDir)
  mkdirSync(pipelineDir, { recursive: true })
  const path = resolve(pipelineDir, name)
  atomicWriteJson(path, value)
  return path
}

export async function runYallaAutopilot(options: AutopilotOptions): Promise<AutopilotRunResult> {
  const issue = options.issue
  const number = issueNumber(issue)
  const mode = parseMode(options.mode)
  const repo = options.repo ?? DEFAULT_REPO
  const rootDir = options.rootDir ?? process.cwd()
  const now = options.now ?? (() => new Date().toISOString())
  const startedAt = now()
  const commandRunner = options.commandRunner ?? defaultCommandRunner
  const commandResults: CommandRecord[] = []
  const sideEffectsAttempted: string[] = []

  function finish(status: Status, githubAuth: AutopilotState['github_auth'], stopReason: string, iterationsUsed: number, issueUrl?: string) {
    return finishRun({
      issue,
      mode,
      rootDir,
      startedAt,
      completedAt: now(),
      status,
      phase: 'stopped',
      githubAuth,
      stopReason,
      commandResults,
      sideEffectsAttempted,
      iterationsUsed,
      issueUrl,
    })
  }

  async function run(command: string, args: string[]) {
    if (mode === 'dry-run') assertDryRunSafe(command, args)
    const result = redactCommandResult(await commandRunner(command, args))
    commandResults.push({ command, args, ...result })
    return result
  }

  const auth = await run('gh', ['auth', 'status'])
  if (auth.exitCode !== 0) {
    return finish('blocked', 'fail', 'missing-github-auth', 0)
  }

  const issueView = await run('gh', ['issue', 'view', number, '--repo', repo, '--json', 'number,title,url,state,labels'])
  if (issueView.exitCode !== 0) {
    return finish('blocked', 'pass', 'issue-probe-failed', 0)
  }

  const issueUrl = parseIssueUrl(issueView.stdout)
  return finish('dry-run-complete', 'pass', 'dry-run-no-mutations', 1, issueUrl)
}

export async function runYallaAutopilotQueue(options: AutopilotQueueOptions): Promise<AutopilotRunResult> {
  const mode = parseMode(options.mode)
  const initialRootDir = options.rootDir ?? process.cwd()
  const loadedConfig = loadYallaConfig({ rootDir: initialRootDir, configPath: options.configPath })
  const config = loadedConfig.config
  const rootDir = options.rootDir ?? loadedConfig.rootDir
  const repo = options.repo ?? config.repo ?? DEFAULT_REPO
  const now = options.now ?? (() => new Date().toISOString())
  const startedAt = now()
  const commandRunner = options.commandRunner ?? defaultCommandRunner
  const commandResults: CommandRecord[] = []
  const sideEffectsAttempted: string[] = []
  const configEligibleLabels = config.autopilot.eligibleLabels.length ? config.autopilot.eligibleLabels : config.taskSystem.readyLabel ? [config.taskSystem.readyLabel] : []
  const configBlockLabels = config.autopilot.blockLabels.length ? config.autopilot.blockLabels : config.taskSystem.blockLabels
  const eligibleLabels = cleanLabels(options.eligibleLabels?.length ? options.eligibleLabels : configEligibleLabels.length ? configEligibleLabels : ['yalla-ready'])
  const blockLabels = cleanLabels(options.blockLabels?.length ? options.blockLabels : configBlockLabels.length ? configBlockLabels : ['blocked', 'needs-human', 'do-not-autopilot'])
  const limit = Number.isFinite(options.limit) && options.limit && options.limit > 0 ? Math.floor(options.limit) : 20

  async function run(command: string, args: string[]) {
    if (mode === 'dry-run') assertDryRunSafe(command, args)
    const result = redactCommandResult(await commandRunner(command, args))
    commandResults.push({ command, args, ...result })
    return result
  }

  function finish(status: Status, githubAuth: AutopilotState['github_auth'], stopReason: string, iterationsUsed: number, report?: unknown) {
    return finishRun({
      issue: 'queue',
      mode,
      rootDir,
      startedAt,
      completedAt: now(),
      status,
      phase: 'stopped',
      githubAuth,
      stopReason,
      commandResults,
      sideEffectsAttempted,
      iterationsUsed,
      report,
    })
  }

  const auth = await run('gh', ['auth', 'status'])
  if (auth.exitCode !== 0) return finish('blocked', 'fail', 'missing-github-auth', 0)

  const listArgs = ['issue', 'list', '--repo', repo, '--state', 'open', '--limit', String(limit), '--json', 'number,title,url,labels,createdAt,updatedAt']
  for (const label of eligibleLabels) listArgs.push('--label', label)
  const issueList = await run('gh', listArgs)
  if (issueList.exitCode !== 0) return finish('blocked', 'pass', 'queue-probe-failed', 0)

  const report = buildQueueReport({
    mode,
    repo,
    eligibleLabels,
    blockLabels,
    configPath: loadedConfig.path,
    configSource: loadedConfig.source,
    generatedAt: now(),
    issues: parseIssueList(issueList.stdout),
  })
  return finish('report-complete', 'pass', report.selected_issue ? 'report-only-selected-candidate' : 'report-only-no-candidates', 1, report)
}

function cleanLabels(labels: string[]) {
  return labels.map(label => label.trim()).filter(Boolean)
}

function parseIssueList(stdout: string): QueueIssue[] {
  if (!stdout.trim()) return []
  const parsed = JSON.parse(stdout) as QueueIssue[]
  return Array.isArray(parsed) ? parsed : []
}

function issueLabels(issue: QueueIssue) {
  return (issue.labels ?? [])
    .map(label => (typeof label === 'string' ? label : label.name ?? ''))
    .filter(Boolean)
}

function scoreIssue(labels: string[]) {
  if (labels.includes('p0') || labels.includes('priority:p0')) return 100
  if (labels.includes('p1') || labels.includes('priority:p1')) return 80
  if (labels.includes('p2') || labels.includes('priority:p2')) return 60
  return 10
}

function buildQueueReport(input: {
  mode: Mode
  repo: string
  eligibleLabels: string[]
  blockLabels: string[]
  configPath?: string
  configSource: string
  generatedAt: string
  issues: QueueIssue[]
}): QueueReport {
  const candidates: QueueReport['candidates'] = []
  const skipped: QueueReport['skipped'] = []

  for (const issue of input.issues) {
    const labels = issueLabels(issue)
    const blockedBy = labels.find(label => input.blockLabels.includes(label))
    const issue_id = `issue-${issue.number}`
    if (blockedBy) {
      skipped.push({ issue_id, title: issue.title, reason: `blocked-label:${blockedBy}` })
      continue
    }

    candidates.push({
      issue_id,
      title: issue.title,
      url: issue.url,
      labels,
      score: scoreIssue(labels),
    })
  }

  candidates.sort((a, b) => b.score - a.score || Number(a.issue_id.replace('issue-', '')) - Number(b.issue_id.replace('issue-', '')))

  return {
    mode: input.mode,
    repo: input.repo,
    eligible_labels: input.eligibleLabels,
    block_labels: input.blockLabels,
    selected_issue: candidates[0]?.issue_id ?? null,
    candidates,
    skipped,
    generated_at: input.generatedAt,
    config_path: input.configPath,
    config_source: input.configSource,
  }
}

function parseIssueUrl(stdout: string) {
  if (!stdout.trim()) return undefined
  try {
    const parsed = JSON.parse(stdout) as { url?: string }
    return parsed.url
  } catch {
    return undefined
  }
}

function finishRun(input: {
  issue: string
  mode: Mode
  rootDir: string
  startedAt: string
  completedAt: string
  status: Status
  phase: AutopilotState['phase']
  githubAuth: AutopilotState['github_auth']
  stopReason: string
  commandResults: CommandRecord[]
  sideEffectsAttempted: string[]
  iterationsUsed: number
  issueUrl?: string
  report?: unknown
}): AutopilotRunResult {
  const state: AutopilotState = {
    schema_version: CONTROL_SCHEMA_VERSION,
    yalla_version: YALLA_CONTROL_VERSION,
    issue_id: input.issue,
    mode: input.mode,
    phase: input.phase,
    status: input.status,
    github_auth: input.githubAuth,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    stop_reason: input.stopReason,
    dry_run_side_effects_blocked: input.mode === 'dry-run',
    lock_owner: `autopilot:${input.issue}`,
    last_safe_checkpoint: null,
    allowed_capabilities: ['read_repo'],
    issue_url: input.issueUrl,
  }
  const telemetry: LoopTelemetry = {
    schema_version: CONTROL_SCHEMA_VERSION,
    yalla_version: YALLA_CONTROL_VERSION,
    issue_id: input.issue,
    mode: input.mode,
    iterations_budget: 1,
    iterations_used: input.iterationsUsed,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    command_results: input.commandResults,
    side_effects_attempted: input.sideEffectsAttempted,
  }

  const pipelineDir = canonicalPipelineStateDir(input.issue, 'autopilot')
  const lock = acquireRunLock(input.rootDir, `autopilot:${input.issue}`, undefined, pipelineDir)
  try {
    const reportPath = input.report === undefined ? undefined : writeJson(input.rootDir, pipelineDir, 'autopilot-queue-report.json', input.report)
    const statePath = writeJson(input.rootDir, pipelineDir, 'autopilot-state.json', state)
    const telemetryPath = writeJson(input.rootDir, pipelineDir, 'loop-telemetry.json', telemetry)
    const logPath = resolve(input.rootDir, pipelineDir, 'run-log.jsonl')
    writeFileSync(logPath, `${JSON.stringify(state)}\n`, { flag: 'a', mode: 0o600 })
    return { status: input.status, exitCode: input.status === 'blocked' ? 1 : 0, statePath, telemetryPath, reportPath }
  } finally {
    releaseRunLock(lock)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const repo = options.repo ?? (options.command === 'run' ? resolveRepo() : undefined)
  const result =
    options.command === 'run'
      ? await runYallaAutopilot({ ...options, repo })
      : await runYallaAutopilotQueue({ ...options, repo })
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = result.exitCode
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
