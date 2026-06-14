import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type YallaConfig = {
  repo?: string
  projectName?: string
  baseBranch?: string
  trackingMode?: string
  testDir?: string
  commands: Record<string, string>
  models: Record<string, string>
  verifiers: Record<string, string>
  taskSystem: {
    readyLabel?: string
    blockLabels: string[]
    priorityLabels: string[]
    riskLabels: string[]
    issueTemplate?: string
  }
  autopilot: {
    enabled?: boolean
    level?: string
    humanMode?: string
    eligibleLabels: string[]
    blockLabels: string[]
    autoMerge?: boolean
    maxRuntimeMinutes?: number
    maxIterations?: number
    tokenBudget?: string
  }
  evals: {
    smokeCommand?: string
    projectFixturesRequiredBeforeAutopilot?: boolean
  }
  ceremony: {
    defaultMode?: string
    allowUserOverride?: boolean
    minimumDiffDefaultFilesBudget?: number
    minimumDiffDefaultLocBudget?: number
  }
  riskGates: Array<{
    name: string
    triggersOn: string[]
  }>
}

export type LoadedYallaConfig = {
  path?: string
  rootDir: string
  source: 'explicit' | 'env' | 'project' | 'missing'
  config: YallaConfig
}

export function inferConfigRoot(configPath: string) {
  const normalized = configPath.replace(/\\/g, '/')
  if (normalized.endsWith('/.claude/YALLA.md')) return dirname(dirname(configPath))
  return dirname(configPath)
}

const DEFAULT_CONFIG: YallaConfig = {
  commands: {},
  models: {},
  verifiers: {},
  taskSystem: {
    blockLabels: [],
    priorityLabels: [],
    riskLabels: [],
  },
  autopilot: {
    eligibleLabels: [],
    blockLabels: [],
  },
  evals: {},
  ceremony: {},
  riskGates: [],
}

export function loadYallaConfig(options: { rootDir?: string; configPath?: string } = {}): LoadedYallaConfig {
  const rootDir = options.rootDir ?? process.cwd()
  const candidates = configCandidates(rootDir, options.configPath)
  const found = candidates.find(candidate => existsSync(candidate.path))

  if (!found) {
    return { source: 'missing', rootDir, config: cloneDefaultConfig() }
  }

  const configRoot = found.source === 'explicit' || found.source === 'env' ? inferConfigRoot(found.path) : rootDir
  return {
    path: found.path,
    rootDir: configRoot,
    source: found.source,
    config: parseYallaConfig(readFileSync(found.path, 'utf8')),
  }
}

function configCandidates(rootDir: string, explicitPath?: string) {
  if (explicitPath) return [{ path: resolve(rootDir, explicitPath), source: 'explicit' as const }]
  if (process.env.YALLA_CONFIG_PATH) return [{ path: resolve(rootDir, process.env.YALLA_CONFIG_PATH), source: 'env' as const }]
  return [{ path: resolve(rootDir, '.claude/YALLA.md'), source: 'project' as const }]
}

function cloneDefaultConfig(): YallaConfig {
  return {
    commands: {},
    models: {},
    verifiers: {},
    taskSystem: { blockLabels: [], priorityLabels: [], riskLabels: [] },
    autopilot: { eligibleLabels: [], blockLabels: [] },
    evals: {},
    ceremony: {},
    riskGates: [],
  }
}

export function parseYallaConfig(input: string): YallaConfig {
  const config = cloneDefaultConfig()
  let section = ''
  let nested = ''
  let currentRiskGate: YallaConfig['riskGates'][number] | undefined

  for (const rawLine of input.split('\n')) {
    const line = stripInlineComment(rawLine).trimEnd()
    if (!line.trim()) continue
    if (line.startsWith('## ')) {
      section = line.slice(3).trim().toLowerCase()
      nested = ''
      continue
    }
    if (line.startsWith('#')) continue

    if (nested === 'risk_gates') {
      const listItem = line.match(/^\s*-\s+name:\s*(.*)$/)
      if (listItem) {
        currentRiskGate = { name: stringValue(parseScalar(listItem[1])), triggersOn: [] }
        config.riskGates.push(currentRiskGate)
        continue
      }

      const riskGateChild = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
      if (riskGateChild && currentRiskGate) {
        applyRiskGate(currentRiskGate, riskGateChild[1], parseScalar(riskGateChild[2]))
        continue
      }
    }

    const top = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
    if (top && !rawLine.startsWith(' ')) {
      const key = top[1]
      const value = top[2]
      nested = value ? '' : key
      applyTopLevel(config, key, value, section)
      continue
    }

    const child = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
    if (child && nested) {
      applyNested(config, nested, child[1], child[2])
    }
  }

  return normalizeConfig(config)
}

function stripInlineComment(line: string) {
  let inQuote: 'single' | 'double' | null = null
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"' && inQuote !== 'single') inQuote = inQuote === 'double' ? null : 'double'
    else if (char === "'" && inQuote !== 'double') inQuote = inQuote === 'single' ? null : 'single'
    else if (char === '#' && !inQuote) return line.slice(0, index)
  }
  return line
}

function applyTopLevel(config: YallaConfig, key: string, rawValue: string, section: string) {
  const value = parseScalar(rawValue)
  if (key === 'repo') config.repo = String(value ?? '')
  else if (key === 'project_name') config.projectName = String(value ?? '')
  else if (key === 'base_branch') config.baseBranch = String(value ?? '')
  else if (key === 'tracking_mode') config.trackingMode = String(value ?? '')
  else if (key === 'test_dir') config.testDir = String(value ?? '')
  else if (section.includes('commands')) config.commands[key] = String(value ?? '')
}

function applyNested(config: YallaConfig, parent: string, key: string, rawValue: string) {
  const value = parseScalar(rawValue)
  if (parent === 'commands') config.commands[key] = String(value ?? '')
  else if (parent === 'models') config.models[key] = String(value ?? '')
  else if (parent === 'verifiers') config.verifiers[key] = String(value ?? '')
  else if (parent === 'task_system') applyTaskSystem(config, key, value)
  else if (parent === 'autopilot') applyAutopilot(config, key, value)
  else if (parent === 'evals') applyEvals(config, key, value)
  else if (parent === 'ceremony') applyCeremony(config, key, value)
}

function applyTaskSystem(config: YallaConfig, key: string, value: unknown) {
  if (key === 'ready_label') config.taskSystem.readyLabel = stringValue(value)
  else if (key === 'block_labels') config.taskSystem.blockLabels = arrayValue(value)
  else if (key === 'priority_labels') config.taskSystem.priorityLabels = arrayValue(value)
  else if (key === 'risk_labels') config.taskSystem.riskLabels = arrayValue(value)
  else if (key === 'issue_template') config.taskSystem.issueTemplate = stringValue(value)
}

function applyAutopilot(config: YallaConfig, key: string, value: unknown) {
  if (key === 'enabled') config.autopilot.enabled = booleanValue(value)
  else if (key === 'level') config.autopilot.level = stringValue(value)
  else if (key === 'human_mode') config.autopilot.humanMode = stringValue(value)
  else if (key === 'eligible_labels') config.autopilot.eligibleLabels = arrayValue(value)
  else if (key === 'block_labels') config.autopilot.blockLabels = arrayValue(value)
  else if (key === 'auto_merge') config.autopilot.autoMerge = booleanValue(value)
  else if (key === 'max_runtime_minutes') config.autopilot.maxRuntimeMinutes = numberValue(value)
  else if (key === 'max_iterations') config.autopilot.maxIterations = numberValue(value)
  else if (key === 'token_budget') config.autopilot.tokenBudget = stringValue(value)
}

function applyEvals(config: YallaConfig, key: string, value: unknown) {
  if (key === 'smoke_command') config.evals.smokeCommand = stringValue(value)
  else if (key === 'project_fixtures_required_before_autopilot') config.evals.projectFixturesRequiredBeforeAutopilot = booleanValue(value)
}

function applyCeremony(config: YallaConfig, key: string, value: unknown) {
  if (key === 'default_mode') config.ceremony.defaultMode = stringValue(value)
  else if (key === 'allow_user_override') config.ceremony.allowUserOverride = booleanValue(value)
  else if (key === 'minimum_diff_default_files_budget') config.ceremony.minimumDiffDefaultFilesBudget = numberValue(value)
  else if (key === 'minimum_diff_default_loc_budget') config.ceremony.minimumDiffDefaultLocBudget = numberValue(value)
}

function applyRiskGate(riskGate: YallaConfig['riskGates'][number], key: string, value: unknown) {
  if (key === 'name') riskGate.name = stringValue(value)
  else if (key === 'triggers_on') riskGate.triggersOn = arrayValue(value)
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map(part => stripQuotes(part.trim())).filter(Boolean)
  }
  return stripQuotes(trimmed)
}

function stripQuotes(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function stringValue(value: unknown) {
  return String(value ?? '')
}

function arrayValue(value: unknown) {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean)
  const string = String(value ?? '').trim()
  return string ? [string] : []
}

function booleanValue(value: unknown) {
  return value === true || value === 'true'
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeConfig(config: YallaConfig): YallaConfig {
  const readyLabel = config.taskSystem.readyLabel
  if (!config.autopilot.eligibleLabels.length && readyLabel) config.autopilot.eligibleLabels = [readyLabel]
  if (!config.autopilot.blockLabels.length && config.taskSystem.blockLabels.length) config.autopilot.blockLabels = [...config.taskSystem.blockLabels]
  return config
}
