#!/usr/bin/env tsx

import { exec, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  containsLikelySandboxSecret,
  validateSandboxProof,
  type SandboxProof,
  type SandboxProfile,
} from '../eval/yalla/schemas/sandbox-proof.js'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

type ConfigProfile = {
  commands: string[]
}

type CrabboxProviderConfig = {
  provider: string
  slugPrefix?: string
  ttl?: string
  idleTimeout?: string
  bootstrapCommands?: string[]
  setupCommands?: string[]
  allowEnv?: string[]
}

type AgentSandboxConfig = {
  defaultProvider: 'local' | 'crabbox'
  workspacePath: string
  providers?: {
    crabbox?: CrabboxProviderConfig
  }
  sync: {
    exclude: string[]
  }
  envAllowlist: string[]
  profiles: Partial<Record<SandboxProfile, ConfigProfile>>
}

type CliCommand = 'doctor' | 'verify' | 'up' | 'run' | 'artifacts' | 'down'

type CliOptions = {
  command: CliCommand
  issue: string
  profile: SandboxProfile | 'auto'
  provider?: 'local' | 'crabbox'
  rootDir: string
  keepAlive: boolean
  providerCheck: boolean
  passthroughCommand: string
}

type CommandRun = {
  command: string
  status: 'pass' | 'fail'
  exitCode: number
  durationMs: number
  stdout: string
  stderr: string
}

type LocalSandboxState = {
  issue_id: string
  provider: string
  sandbox_id: string
  path: string
  created_at: string
}

const profileOrder: SandboxProfile[] = ['delivery', 'money', 'schema', 'mcp', 'ui-smoke', 'fast']
const profilesRequiringDatabase = new Set<SandboxProfile>(['schema', 'money', 'delivery'])
const validProfiles = new Set<SandboxProfile>(['fast', 'ui-smoke', 'mcp', 'schema', 'money', 'delivery'])

function nowIso() {
  return new Date().toISOString()
}

function sha256(value: string | Buffer) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function statePath(rootDir: string, issue: string) {
  return resolve(rootDir, '.pipeline', 'agent-sandbox-state', `${issue}.json`)
}

function proofPath(rootDir: string) {
  return resolve(rootDir, '.pipeline', 'agent-sandbox-proof.json')
}

function artifactsDir(rootDir: string, runId: string) {
  return resolve(rootDir, '.pipeline', 'agent-sandbox-artifacts', runId)
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function parseIssueId(value: string) {
  if (!/^issue-\d+$/.test(value)) {
    throw new Error('Issue must use canonical issue-### format.')
  }
  return value
}

export function normalizeRelativePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '')
}

function escapeRegex(value: string) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

export function matchesExclude(relativePath: string, pattern: string) {
  const normalizedPath = normalizeRelativePath(relativePath)
  const normalizedPattern = normalizeRelativePath(pattern)

  if (normalizedPattern.endsWith('/')) {
    const prefix = normalizedPattern.slice(0, -1)
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  }

  if (normalizedPattern.includes('*')) {
    const regex = new RegExp(`^${normalizedPattern.split('*').map(escapeRegex).join('[^/]*')}$`)
    return regex.test(normalizedPath)
  }

  return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`)
}

export function isExcluded(relativePath: string, excludes: string[]) {
  return excludes.some(pattern => matchesExclude(relativePath, pattern))
}

export function loadConfig(rootDir: string): AgentSandboxConfig {
  const configPath = resolve(rootDir, 'agent-sandbox.config.json')
  if (!existsSync(configPath)) {
    throw new Error('agent-sandbox.config.json is required.')
  }

  return validateConfig(JSON.parse(readFileSync(configPath, 'utf8')))
}

export function validateConfig(input: unknown): AgentSandboxConfig {
  if (!input || typeof input !== 'object') throw new Error('Agent sandbox config must be an object.')
  const config = input as Partial<AgentSandboxConfig>
  if (config.defaultProvider !== 'local' && config.defaultProvider !== 'crabbox') throw new Error('defaultProvider must be local or crabbox.')
  if (typeof config.workspacePath !== 'string' || config.workspacePath.length === 0) {
    throw new Error('Config requires workspacePath.')
  }
  if (!config.sync || !Array.isArray(config.sync.exclude)) throw new Error('Config requires sync.exclude.')
  if (!Array.isArray(config.envAllowlist)) throw new Error('Config requires envAllowlist.')
  if (!config.profiles || typeof config.profiles !== 'object') throw new Error('Config requires profiles.')
  if (!config.profiles.fast?.commands?.length) throw new Error('Config requires profiles.fast.commands.')
  if (config.providers?.crabbox) {
    const crabbox = config.providers.crabbox
    if (typeof crabbox.provider !== 'string' || crabbox.provider.length === 0) throw new Error('providers.crabbox.provider is required.')
    if (crabbox.allowEnv && !Array.isArray(crabbox.allowEnv)) throw new Error('providers.crabbox.allowEnv must be an array.')
    if (crabbox.bootstrapCommands && !Array.isArray(crabbox.bootstrapCommands)) throw new Error('providers.crabbox.bootstrapCommands must be an array.')
    if (crabbox.setupCommands && !Array.isArray(crabbox.setupCommands)) throw new Error('providers.crabbox.setupCommands must be an array.')
  }

  for (const key of Object.keys(config.profiles)) {
    if (!validProfiles.has(key as SandboxProfile)) throw new Error(`Unknown sandbox profile: ${key}.`)
    const profile = config.profiles[key as SandboxProfile]
    if (!profile || !Array.isArray(profile.commands) || profile.commands.some(command => typeof command !== 'string' || command.length === 0)) {
      throw new Error(`Profile ${key} requires non-empty command strings.`)
    }
  }

  for (const denied of ['.env', '.env.local', '.env*']) {
    if (!config.sync.exclude.some(pattern => matchesExclude(denied, pattern))) {
      throw new Error('Config must exclude .env* files.')
    }
  }

  return config as AgentSandboxConfig
}

function readDirectoryRecursive(rootDir: string, currentDir: string, excludes: string[], output: string[] = []) {
  for (const entry of readdirSync(currentDir)) {
    const absolute = join(currentDir, entry)
    const rel = normalizeRelativePath(relative(rootDir, absolute))
    if (isExcluded(rel, excludes)) continue
    const stat = lstatSync(absolute)
    output.push(rel)
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      readDirectoryRecursive(rootDir, absolute, excludes, output)
    }
  }
  return output
}

function copyWorkspace(rootDir: string, targetDir: string, excludes: string[]) {
  const entries = readDirectoryRecursive(rootDir, rootDir, excludes)
  for (const rel of entries) {
    const source = resolve(rootDir, rel)
    const target = resolve(targetDir, rel)
    const stat = lstatSync(source)
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      mkdirSync(target, { recursive: true })
    } else if (stat.isSymbolicLink()) {
      mkdirSync(dirname(target), { recursive: true })
      symlinkSync(readlinkSync(source), target)
    } else if (stat.isFile()) {
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
    }
  }
}

async function gitOutput(rootDir: string, args: string[]) {
  try {
    const result = await execFileAsync('git', args, { cwd: rootDir, maxBuffer: 20 * 1024 * 1024 })
    return result.stdout
  } catch {
    return ''
  }
}

export async function collectGitEvidence(rootDir: string) {
  const status = await gitOutput(rootDir, ['status', '--porcelain=v1'])
  const changedFiles = status
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(line => normalizeRelativePath(line.slice(3)))
    .filter(Boolean)

  const baseSha = (await gitOutput(rootDir, ['rev-parse', '--verify', 'HEAD'])).trim() || 'unknown'
  const diff = await gitOutput(rootDir, ['diff', '--binary', 'HEAD', '--'])
  const untrackedHashes = changedFiles
    .filter(file => existsSync(resolve(rootDir, file)) && !statSync(resolve(rootDir, file)).isDirectory())
    .map(file => `${file}:${sha256(readFileSync(resolve(rootDir, file)))}`)
    .join('\n')

  return {
    baseSha,
    changedFiles,
    dirtyDiffSha256: sha256([status, diff, untrackedHashes].join('\n')),
  }
}

export function selectVerificationProfile(changedFiles: string[], issueBody = ''): SandboxProfile {
  const haystack = [...changedFiles, issueBody].join('\n').toLowerCase()
  const candidates: SandboxProfile[] = []

  if (/(repo-generator|api\/jobs|qstash|artifact|delivery|repo_generation|clone-orchestrator|generated-artifacts|async-jobs)/.test(haystack)) candidates.push('delivery')
  if (/(stripe|checkout|pricing|entitlement|coupon|promo|payment|subscription|money)/.test(haystack)) candidates.push('money')
  if (/(migrations|supabase|tenant[_ -]?schema|schema_migrations|row level security|\brls\b|\.sql\b|migration)/.test(haystack)) candidates.push('schema')
  if (/(yalla-mcp|api\/mcp|lib\/mcp|tests\/mcp|mcp\b|tool inventory)/.test(haystack)) candidates.push('mcp')
  if (/(^|\/)src\/|tests\/playwright|playwright|\.tsx\b|browser|ui\b|responsive|frontend/.test(haystack)) candidates.push('ui-smoke')

  return profileOrder.find(profile => candidates.includes(profile)) ?? 'fast'
}

function commandStatus(exitCode: number): 'pass' | 'fail' {
  return exitCode === 0 ? 'pass' : 'fail'
}

async function runShellCommand(command: string, cwd: string): Promise<CommandRun> {
  const started = Date.now()
  try {
    const result = await execAsync(command, { cwd, maxBuffer: 20 * 1024 * 1024 })
    return {
      command,
      status: 'pass',
      exitCode: 0,
      durationMs: Date.now() - started,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    const exitCode = typeof failure.code === 'number' ? failure.code : 1
    return {
      command,
      status: commandStatus(exitCode),
      exitCode,
      durationMs: Date.now() - started,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

function saveCommandArtifacts(runArtifactsDir: string, index: number, run: CommandRun) {
  const commandDir = resolve(runArtifactsDir, `command-${index + 1}`)
  mkdirSync(commandDir, { recursive: true })
  const stdoutPath = resolve(commandDir, 'stdout.log')
  const stderrPath = resolve(commandDir, 'stderr.log')
  writeFileSync(stdoutPath, run.stdout)
  writeFileSync(stderrPath, run.stderr)
  return { stdoutPath, stderrPath }
}

function toRelativeArtifact(rootDir: string, path: string) {
  return normalizeRelativePath(relative(rootDir, path))
}

function localProviderDatabaseMode(): SandboxProof['isolation']['database'] {
  return 'not-required'
}

function databaseModeForProvider(provider: string, profile: SandboxProfile, setupCommands: string[]): SandboxProof['isolation']['database'] {
  if (provider.startsWith('crabbox') && profilesRequiringDatabase.has(profile) && setupCommands.length > 0) {
    return 'local-supabase'
  }

  return localProviderDatabaseMode()
}

function buildProof(input: {
  issue: string
  profile: SandboxProfile
  state: LocalSandboxState
  rootDir: string
  runArtifactsDir: string
  startedAt: string
  completedAt: string
  git: Awaited<ReturnType<typeof collectGitEvidence>>
  commandRuns: CommandRun[]
  teardownStatus: SandboxProof['teardown']['status']
  databaseMode?: SandboxProof['isolation']['database']
}) {
  const commandArtifacts = input.commandRuns.map((run, index) => {
    const refs = saveCommandArtifacts(input.runArtifactsDir, index, run)
    return {
      command: run.command,
      status: run.status,
      exit_code: run.exitCode,
      duration_ms: run.durationMs,
      stdout_ref: toRelativeArtifact(input.rootDir, refs.stdoutPath),
      stderr_ref: toRelativeArtifact(input.rootDir, refs.stderrPath),
    }
  })

  const artifactEntries = commandArtifacts.flatMap(command => [
    { kind: 'log' as const, path: command.stdout_ref, sha256: sha256(readFileSync(resolve(input.rootDir, command.stdout_ref))) },
    { kind: 'log' as const, path: command.stderr_ref, sha256: sha256(readFileSync(resolve(input.rootDir, command.stderr_ref))) },
  ])

  const logText = input.commandRuns.map(run => `${run.stdout}\n${run.stderr}`).join('\n')
  const redactionStatus = containsLikelySandboxSecret(logText) ? 'fail' : 'pass'
  const database = input.databaseMode ?? localProviderDatabaseMode()
  const requiredDatabaseMissing = profilesRequiringDatabase.has(input.profile) && database === 'not-required'
  const commandsPassed = input.commandRuns.length > 0 && input.commandRuns.every(run => run.status === 'pass')
  const teardownPassed = input.teardownStatus === 'pass' || input.teardownStatus === 'kept-alive'
  const verdict = commandsPassed && redactionStatus === 'pass' && teardownPassed && !requiredDatabaseMissing ? 'PROVEN' : 'NOT_PROVEN'

  return {
    schema_version: 1,
    issue_id: input.issue,
    profile: input.profile,
    provider: input.state.provider,
    sandbox_id: input.state.sandbox_id,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    git: {
      base_sha: input.git.baseSha,
      dirty_diff_sha256: input.git.dirtyDiffSha256,
      changed_files: input.git.changedFiles,
    },
    isolation: {
      workspace: 'clean-copy',
      app_server: input.profile === 'ui-smoke' ? 'sandbox-owned' : 'not-required',
      database,
      network: 'provider-default',
    },
    commands: commandArtifacts,
    artifacts: artifactEntries,
    redaction: {
      status: redactionStatus,
      patterns_checked: ['token', 'secret', 'stripe', 'supabase', 'github', 'vercel', 'anthropic'],
    },
    teardown: {
      status: input.teardownStatus,
      completed_at: input.completedAt,
    },
    verdict,
  } satisfies SandboxProof
}

export function createLocalSandbox(rootDir: string, issue: string, config: AgentSandboxConfig) {
  const sandboxRoot = mkdtempSync(join(tmpdir(), 'yalla-agent-sandbox-'))
  const target = resolve(sandboxRoot, basename(rootDir))
  mkdirSync(target, { recursive: true })
  copyWorkspace(rootDir, target, config.sync.exclude)
  const state: LocalSandboxState = {
    issue_id: issue,
    provider: 'local',
    sandbox_id: `local-${Date.now().toString(36)}`,
    path: target,
    created_at: nowIso(),
  }
  writeJson(statePath(rootDir, issue), state)
  return state
}

function readLocalState(rootDir: string, issue: string) {
  const path = statePath(rootDir, issue)
  if (!existsSync(path)) throw new Error(`No sandbox state found for ${issue}. Run up or verify first.`)
  return readJson<LocalSandboxState>(path)
}

export function removeLocalSandbox(rootDir: string, issue: string) {
  const path = statePath(rootDir, issue)
  if (!existsSync(path)) return { status: 'pass' as const, message: 'already-removed' }
  const state = readJson<LocalSandboxState>(path)
  rmSync(dirname(state.path), { recursive: true, force: true })
  rmSync(path, { force: true })
  return { status: 'pass' as const, message: 'removed' }
}

function parseCliArgs(argv: string[]): CliOptions {
  const command = argv.shift() as CliCommand | undefined
  if (!command || !['doctor', 'verify', 'up', 'run', 'artifacts', 'down'].includes(command)) {
    throw new Error('Usage: agent-sandbox doctor|verify|up|run|artifacts|down [--issue issue-###] [--profile auto|fast|ui-smoke|mcp|schema|money|delivery]')
  }

  let issue = 'issue-0000'
  let profile: SandboxProfile | 'auto' = 'auto'
  let provider: CliOptions['provider']
  let rootDir = process.cwd()
  let keepAlive = false
  let providerCheck = false
  let passthroughCommand = ''

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--issue') issue = parseIssueId(argv[++index] ?? '')
    else if (arg === '--profile') {
      const value = argv[++index] ?? ''
      if (value !== 'auto' && !validProfiles.has(value as SandboxProfile)) throw new Error(`Unknown profile: ${value}.`)
      profile = value as SandboxProfile | 'auto'
    } else if (arg === '--root') rootDir = resolve(argv[++index] ?? '')
    else if (arg === '--provider') {
      const value = argv[++index] ?? ''
      if (value !== 'local' && value !== 'crabbox') throw new Error(`Unknown provider: ${value}.`)
      provider = value
    }
    else if (arg === '--keep-alive') keepAlive = true
    else if (arg === '--provider-check') providerCheck = true
    else if (arg === '--') {
      passthroughCommand = argv.slice(index + 1).join(' ')
      break
    } else {
      throw new Error(`Unknown arg: ${arg}`)
    }
  }

  return { command, issue, profile, provider, rootDir, keepAlive, providerCheck, passthroughCommand }
}

async function executableExists(command: string) {
  try {
    await execFileAsync('sh', ['-lc', `command -v ${command}`], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

export async function doctor(rootDir: string, options: { provider?: 'local' | 'crabbox'; providerCheck?: boolean } = {}) {
  const config = loadConfig(rootDir)
  const provider = options.provider ?? config.defaultProvider
  const violations: string[] = []
  if (!config.sync.exclude.some(pattern => matchesExclude('.env.local', pattern))) violations.push('Missing .env* exclude.')
  if (!config.sync.exclude.some(pattern => matchesExclude('node_modules/foo.js', pattern))) violations.push('Missing node_modules exclude.')
  if (!config.profiles.fast?.commands.length) violations.push('Missing fast profile commands.')
  if (provider === 'crabbox') {
    if (!config.providers?.crabbox) violations.push('providers.crabbox config is required.')
    if (!(await executableExists('crabbox'))) {
      violations.push('crabbox CLI is not installed. Install with: brew install openclaw/tap/crabbox')
    } else if (options.providerCheck && config.providers?.crabbox) {
      const result = await runCrabboxDoctor(rootDir, config.providers.crabbox)
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      if (result.exitCode !== 0) violations.push(`crabbox doctor failed: ${output || 'unknown error'}`)
    }
  }
  return { status: violations.length === 0 ? 'pass' : 'fail', provider, violations }
}

export async function verify(options: Pick<CliOptions, 'issue' | 'profile' | 'provider' | 'rootDir' | 'keepAlive'>) {
  const config = loadConfig(options.rootDir)
  const git = await collectGitEvidence(options.rootDir)
  const selectedProfile = options.profile === 'auto' ? selectVerificationProfile(git.changedFiles) : options.profile
  const profileConfig = config.profiles[selectedProfile]
  if (!profileConfig) throw new Error(`Profile is not configured: ${selectedProfile}.`)

  const provider = options.provider ?? config.defaultProvider
  if (provider === 'crabbox') {
    return verifyCrabbox({ ...options, profile: selectedProfile }, config, profileConfig, git)
  }

  const startedAt = nowIso()
  const state = createLocalSandbox(options.rootDir, options.issue, config)
  const runId = `${options.issue}-${Date.now().toString(36)}`
  const runArtifactsDir = artifactsDir(options.rootDir, runId)
  mkdirSync(runArtifactsDir, { recursive: true })

  const commandRuns: CommandRun[] = []
  let teardownStatus: SandboxProof['teardown']['status'] = options.keepAlive ? 'kept-alive' : 'pass'
  try {
    for (const command of profileConfig.commands) {
      const result = await runShellCommand(command, state.path)
      commandRuns.push(result)
      if (result.status !== 'pass') break
    }
  } finally {
    if (!options.keepAlive) {
      try {
        removeLocalSandbox(options.rootDir, options.issue)
      } catch {
        teardownStatus = 'fail'
      }
    }
  }

  const proof = buildProof({
    issue: options.issue,
    profile: selectedProfile,
    state,
    rootDir: options.rootDir,
    runArtifactsDir,
    startedAt,
    completedAt: nowIso(),
    git,
    commandRuns,
    teardownStatus,
  })
  const validation = validateSandboxProof(proof)
  const finalProof = validation.valid ? proof : { ...proof, verdict: 'NOT_PROVEN' as const }
  writeJson(proofPath(options.rootDir), finalProof)
  return { proof: finalProof, proofPath: proofPath(options.rootDir), validation }
}

function parseEnvFile(path: string) {
  if (!existsSync(path)) return {}
  const env: Record<string, string> = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const index = line.indexOf('=')
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function localAllowedEnv(rootDir: string, allowlist: string[]) {
  const localEnv = {
    ...parseEnvFile(resolve(rootDir, '.env.local')),
    ...parseEnvFile(resolve(rootDir, '.env.staging.local')),
    ...process.env,
  }
  const output: Record<string, string> = {}
  for (const key of allowlist) {
    const value = localEnv[key]
    if (typeof value === 'string' && value.length > 0) output[key] = value
  }
  return output
}

async function runCrabboxDoctor(rootDir: string, crabbox: CrabboxProviderConfig) {
  const args = ['doctor', '--provider', process.env.AGENT_SANDBOX_CRABBOX_PROVIDER || crabbox.provider]
  return runExecFile('crabbox', args, rootDir, process.env)
}

async function runExecFile(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CommandRun> {
  const started = Date.now()
  try {
    const result = await execFileAsync(command, args, { cwd, env, maxBuffer: 20 * 1024 * 1024 })
    return {
      command: [command, ...args].join(' '),
      status: 'pass',
      exitCode: 0,
      durationMs: Date.now() - started,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    const exitCode = typeof failure.code === 'number' ? failure.code : 1
    return {
      command: [command, ...args].join(' '),
      status: commandStatus(exitCode),
      exitCode,
      durationMs: Date.now() - started,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

function crabboxSlug(issue: string, config: CrabboxProviderConfig) {
  const prefix = config.slugPrefix ?? 'yalla'
  return `${prefix}-${issue}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
}

export function buildRemoteShellCommand(profile: SandboxProfile, bootstrapCommands: string[], setupCommands: string[], profileCommands: string[]) {
  const parts: string[] = []
  parts.push(...bootstrapCommands)
  if (profilesRequiringDatabase.has(profile)) {
    parts.push(...setupCommands)
    parts.push('if [ -f .pipeline/local-supabase-mapped.env ]; then set -a; . .pipeline/local-supabase-mapped.env; set +a; fi')
  }
  parts.push(...profileCommands)
  return parts.join(' && ')
}

async function verifyCrabbox(
  options: Pick<CliOptions, 'issue' | 'rootDir' | 'keepAlive'> & { profile: SandboxProfile },
  config: AgentSandboxConfig,
  profileConfig: ConfigProfile,
  git: Awaited<ReturnType<typeof collectGitEvidence>>
) {
  const crabbox = config.providers?.crabbox
  if (!crabbox) throw new Error('providers.crabbox config is required.')
  const startedAt = nowIso()
  const runId = `${options.issue}-${Date.now().toString(36)}`
  const runArtifactsDir = artifactsDir(options.rootDir, runId)
  mkdirSync(runArtifactsDir, { recursive: true })

  const setupCommands = crabbox.setupCommands ?? []
  const bootstrapCommands = crabbox.bootstrapCommands ?? []
  const remoteCommand = buildRemoteShellCommand(options.profile, bootstrapCommands, setupCommands, profileConfig.commands)
  const slug = crabboxSlug(options.issue, crabbox)
  const crabboxProvider = process.env.AGENT_SANDBOX_CRABBOX_PROVIDER || crabbox.provider
  const allowEnv = crabbox.allowEnv ?? config.envAllowlist
  const args = [
    'run',
    '--provider',
    crabboxProvider,
    '--slug',
    slug,
    '--ttl',
    crabbox.ttl ?? '90m',
    '--idle-timeout',
    crabbox.idleTimeout ?? '30m',
    '--stop-after',
    options.keepAlive ? 'never' : 'always',
  ]
  for (const key of allowEnv) {
    args.push('--allow-env', key)
  }
  args.push('--shell', remoteCommand)

  const env = { ...process.env, ...localAllowedEnv(options.rootDir, allowEnv) }
  const run = await runExecFile('crabbox', args, options.rootDir, env)
  const completedAt = nowIso()
  const providerName = `crabbox:${crabboxProvider}`
  const proof = buildProof({
    issue: options.issue,
    profile: options.profile,
    state: {
      issue_id: options.issue,
      provider: providerName,
      sandbox_id: slug,
      path: '',
      created_at: startedAt,
    },
    rootDir: options.rootDir,
    runArtifactsDir,
    startedAt,
    completedAt,
    git,
    commandRuns: [run],
    teardownStatus: options.keepAlive ? 'kept-alive' : 'pass',
    databaseMode: databaseModeForProvider(providerName, options.profile, setupCommands),
  })
  const validation = validateSandboxProof(proof)
  const finalProof = validation.valid ? proof : { ...proof, verdict: 'NOT_PROVEN' as const }
  writeJson(proofPath(options.rootDir), finalProof)
  return { proof: finalProof, proofPath: proofPath(options.rootDir), validation }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2))
  if (options.command === 'doctor') {
    const result = await doctor(options.rootDir, { provider: options.provider, providerCheck: options.providerCheck })
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.status === 'pass' ? 0 : 1
    return
  }

  if (options.command === 'up') {
    const state = createLocalSandbox(options.rootDir, options.issue, loadConfig(options.rootDir))
    console.log(JSON.stringify(state, null, 2))
    return
  }

  if (options.command === 'down') {
    console.log(JSON.stringify(removeLocalSandbox(options.rootDir, options.issue), null, 2))
    return
  }

  if (options.command === 'run') {
    if (!options.passthroughCommand) throw new Error('run requires a command after --.')
    const state = readLocalState(options.rootDir, options.issue)
    const result = await runShellCommand(options.passthroughCommand, state.path)
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.exitCode
    return
  }

  if (options.command === 'artifacts') {
    const root = resolve(options.rootDir, '.pipeline', 'agent-sandbox-artifacts')
    const artifacts = existsSync(root) ? readDirectoryRecursive(root, root, []) : []
    console.log(JSON.stringify({ root, artifacts }, null, 2))
    return
  }

  const result = await verify(options)
  console.log(JSON.stringify({ proofPath: result.proofPath, verdict: result.proof.verdict, validation: result.validation }, null, 2))
  process.exitCode = result.proof.verdict === 'PROVEN' ? 0 : 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
