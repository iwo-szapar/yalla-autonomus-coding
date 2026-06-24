#!/usr/bin/env tsx

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { loadYallaConfig, type LoadedYallaConfig } from './yalla-config.js'

const execFileAsync = promisify(execFile)

type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>

type CheckStatus = 'pass' | 'warn' | 'fail'

type Check = {
  name: string
  status: CheckStatus
  detail: string
}

type OnboardOptions = {
  command: 'check' | 'labels' | 'template' | 'dashboard' | 'init'
  rootDir?: string
  configPath?: string
  dryRun?: boolean
  apply?: boolean
  commandRunner?: CommandRunner
}

const DEFAULT_LABELS = [
  { name: 'yalla-ready', color: '0E8A16', description: 'Ready for Yalla automation' },
  { name: 'blocked', color: 'B60205', description: 'Blocked from execution' },
  { name: 'needs-human', color: 'D93F0B', description: 'Needs human clarification' },
  { name: 'do-not-autopilot', color: '5319E7', description: 'Never select for autopilot' },
  { name: 'p0', color: 'B60205', description: 'Highest priority' },
  { name: 'p1', color: 'D93F0B', description: 'High priority' },
  { name: 'p2', color: 'FBCA04', description: 'Normal priority' },
]

const CANONICAL_RISK_GATES = new Set([
  'security-check',
  'correctness-check',
  'test-evidence-check',
  'reviewability-check',
  'intended-vs-implemented-check',
  'complexity-check',
  'slop-check',
  'architecture-check',
  'architecture-docs-check',
  'architecture-depth-check',
  'doc-alignment-check',
  'cross-platform-check',
  'voice-check',
  'async-reliability-check',
  'schema-migration-check',
  'identity-routing-check',
  'payment-integrity-check',
  'email-delivery-check',
  'generated-artifact-check',
  'ui-journey-check',
  'browser-interaction-check',
  'operator-understanding-check',
  'memory-routing-check',
])

const CANONICAL_MODEL_ROUTES = new Set(['classify', 'plan', 'implement', 'test', 'review', 'summarize'])
const CANONICAL_VERIFIERS = new Set([
  'api',
  'ui',
  'browser_interactions',
  'perf',
  'docs',
  'research',
  'visual',
  'benchmark',
  'security',
  'accessibility',
])
const TRACKING_MODES = new Set(['github', 'linear', 'file-only', 'db'])

export type OnboardResult = {
  exitCode: number
  checks?: Check[]
  missingLabels?: string[]
  commands?: string[]
  templateTarget?: string
  dashboardPath?: string
  applied?: boolean
}

function parseArgs(argv: string[]): OnboardOptions {
  const command = argv[0]
  if (command !== 'check' && command !== 'labels' && command !== 'template' && command !== 'dashboard' && command !== 'init') {
    throw new Error('Usage: tsx scripts/yalla-onboard.ts check|labels|template|dashboard|init [--config path] [--dry-run|--apply]')
  }

  let configPath: string | undefined
  let dryRun = false
  let apply = false
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--config') configPath = argv[++index] ?? ''
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--apply') apply = true
    else throw new Error(`Unknown arg: ${arg}`)
  }

  return { command, configPath, dryRun, apply }
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

export async function runYallaOnboard(options: OnboardOptions): Promise<OnboardResult> {
  const rootDir = options.rootDir ?? process.cwd()
  const loadedConfig = loadYallaConfig({ rootDir, configPath: options.configPath })
  const targetRoot = loadedConfig.rootDir
  if (options.command === 'check') return runCheck(targetRoot, loadedConfig, options.commandRunner ?? defaultCommandRunner)
  if (options.command === 'labels') return runLabels(targetRoot, loadedConfig, options.commandRunner ?? defaultCommandRunner, Boolean(options.apply))
  if (options.command === 'dashboard' || options.command === 'init') return runDashboard(targetRoot, loadedConfig, options.commandRunner ?? defaultCommandRunner)
  return runTemplate(targetRoot, loadedConfig, Boolean(options.apply))
}

async function runCheck(rootDir: string, loadedConfig: LoadedYallaConfig, commandRunner: CommandRunner): Promise<OnboardResult> {
  const checks: Check[] = []
  const config = loadedConfig.config
  checks.push({ name: 'config', status: loadedConfig.path ? 'pass' : 'fail', detail: loadedConfig.path ?? 'Missing .claude/YALLA.md or --config path' })
  checks.push({ name: 'base_branch', status: config.baseBranch ? 'pass' : 'fail', detail: config.baseBranch ?? 'Missing base_branch' })
  checks.push(trackingModeCheck(config.trackingMode))
  checks.push(taskSystemProviderCheck(config.trackingMode, config.taskSystem))
  checks.push(commandCheck('commands.test', config.commands.test))
  checks.push(commandCheck('commands.typecheck', config.commands.typecheck))
  checks.push(commandCheck('commands.build', config.commands.build))
  checks.push(commandCheck('commands.lint', config.commands.lint))
  checks.push(modelRoutingCheck(config.models))
  checks.push(verifierRegistryCheck(config.verifiers))
  checks.push({ name: 'test_dir', status: config.testDir && existsSync(resolve(rootDir, config.testDir)) ? 'pass' : 'warn', detail: config.testDir ?? 'Missing test_dir' })
  checks.push(riskGateCheck(config.riskGates.map(gate => gate.name).filter(Boolean)))
  checks.push({ name: 'autopilot_default', status: config.autopilot.enabled ? 'warn' : 'pass', detail: config.autopilot.enabled ? 'Autopilot enabled; confirm readiness checklist passed' : 'Autopilot disabled by default' })

  const auth = await commandRunner('gh', ['auth', 'status'])
  checks.push({ name: 'github_auth', status: auth.exitCode === 0 ? 'pass' : 'warn', detail: auth.exitCode === 0 ? 'gh authenticated' : 'gh unavailable or unauthenticated; file-only fallback expected' })

  if (auth.exitCode === 0 && (config.trackingMode ?? 'github') === 'github') {
    const labels = await missingLabels(commandRunner, requiredLabels(loadedConfig), config.repo)
    checks.push({ name: 'github_labels', status: labels.length ? 'warn' : 'pass', detail: labels.length ? `Missing labels: ${labels.join(', ')}` : 'Required labels exist' })
  } else if ((config.trackingMode ?? 'github') !== 'github') {
    checks.push({ name: 'github_labels', status: 'pass', detail: `Skipped for tracking_mode=${config.trackingMode}` })
  }

  const hasFailure = checks.some(check => check.status === 'fail')
  return { exitCode: hasFailure ? 1 : 0, checks }
}

function trackingModeCheck(value: string | undefined): Check {
  const mode = value || 'github'
  if (!value) return { name: 'tracking_mode', status: 'warn', detail: 'Defaulting to github' }
  if (!TRACKING_MODES.has(mode)) return { name: 'tracking_mode', status: 'fail', detail: `Unknown tracking_mode=${mode}` }
  return { name: 'tracking_mode', status: 'pass', detail: mode }
}

function taskSystemProviderCheck(
  trackingMode: string | undefined,
  taskSystem: LoadedYallaConfig['config']['taskSystem']
): Check {
  const mode = trackingMode || 'github'
  const provider = taskSystem.provider || mode

  if (mode === 'linear' || provider === 'linear') {
    const hasStates = taskSystem.readyStates.length > 0 && Boolean(taskSystem.inProgressState && taskSystem.reviewState)
    const hasScope = Boolean(taskSystem.team || taskSystem.project)
    if (!hasStates) {
      return {
        name: 'task_system_provider',
        status: 'warn',
        detail: 'Linear configured; add ready_states, in_progress_state, and review_state so status transitions are unambiguous',
      }
    }
    return {
      name: 'task_system_provider',
      status: hasScope ? 'pass' : 'warn',
      detail: hasScope
        ? `Linear provider configured (${taskSystem.team || taskSystem.project})`
        : 'Linear provider configured; add team or project to narrow queue selection',
    }
  }

  return { name: 'task_system_provider', status: 'pass', detail: `Provider=${provider}` }
}

function commandCheck(name: string, value: string | undefined): Check {
  if (value === '') return { name, status: 'warn', detail: 'Gate intentionally skipped' }
  if (value) return { name, status: 'pass', detail: value }
  return { name, status: 'fail', detail: 'Missing command or explicit empty string' }
}

function riskGateCheck(names: string[]): Check {
  if (!names.length) return { name: 'risk_gates', status: 'warn', detail: 'No risk gates configured' }
  const unknown = names.filter(name => !CANONICAL_RISK_GATES.has(name))
  if (unknown.length) {
    return {
      name: 'risk_gates',
      status: 'fail',
      detail: `Unknown risk gate(s): ${unknown.join(', ')}. Check names against knowledge/yalla/REVIEW-CHECKS.md`,
    }
  }
  return { name: 'risk_gates', status: 'pass', detail: `${names.length} canonical risk gate(s) configured` }
}

function modelRoutingCheck(models: Record<string, string>): Check {
  const keys = Object.keys(models)
  if (!keys.length) return { name: 'model_routing', status: 'warn', detail: 'No models block configured; default Claude Code model will be used for all phases' }
  const unknown = keys.filter(key => !CANONICAL_MODEL_ROUTES.has(key))
  if (unknown.length) return { name: 'model_routing', status: 'fail', detail: `Unknown model route(s): ${unknown.join(', ')}` }
  return { name: 'model_routing', status: 'pass', detail: keys.map(key => `${key}=${models[key]}`).join(', ') }
}

function verifierRegistryCheck(verifiers: Record<string, string>): Check {
  const keys = Object.keys(verifiers)
  if (!keys.length) return { name: 'verifier_registry', status: 'warn', detail: 'No verifiers block configured; agents must infer proof commands from project context' }
  const unknown = keys.filter(key => !CANONICAL_VERIFIERS.has(key))
  if (unknown.length) return { name: 'verifier_registry', status: 'fail', detail: `Unknown verifier route(s): ${unknown.join(', ')}` }
  return { name: 'verifier_registry', status: 'pass', detail: keys.map(key => `${key}=${verifiers[key]}`).join(', ') }
}

async function runLabels(_rootDir: string, loadedConfig: LoadedYallaConfig, commandRunner: CommandRunner, apply: boolean): Promise<OnboardResult> {
  const labels = requiredLabels(loadedConfig)
  const missing = await missingLabels(commandRunner, labels, loadedConfig.config.repo)
  const commands = missing.map(label => {
    const definition = DEFAULT_LABELS.find(item => item.name === label)
    return definition
      ? `gh label create ${definition.name} --color ${definition.color} --description "${definition.description}"`
      : `gh label create ${label}`
  })

  if (apply) {
    for (const label of missing) {
      const definition = DEFAULT_LABELS.find(item => item.name === label)
      const args = ['label', 'create', label]
      if (loadedConfig.config.repo) args.push('--repo', loadedConfig.config.repo)
      if (definition) args.push('--color', definition.color, '--description', definition.description)
      const result = await commandRunner('gh', args)
      if (result.exitCode !== 0) return { exitCode: 1, missingLabels: missing, commands, applied: false }
    }
  }

  return { exitCode: 0, missingLabels: missing, commands, applied: apply }
}

async function missingLabels(commandRunner: CommandRunner, labels: string[], repo?: string) {
  const args = ['label', 'list', '--json', 'name']
  if (repo) args.push('--repo', repo)
  const result = await commandRunner('gh', args)
  if (result.exitCode !== 0) return labels
  const existing = parseLabelNames(result.stdout)
  return labels.filter(label => !existing.has(label))
}

function parseLabelNames(stdout: string) {
  try {
    const parsed = JSON.parse(stdout) as Array<{ name?: string }>
    return new Set(parsed.map(label => label.name).filter(Boolean) as string[])
  } catch {
    return new Set<string>()
  }
}

function requiredLabels(loadedConfig: LoadedYallaConfig) {
  const config = loadedConfig.config
  return unique([
    config.taskSystem.readyLabel || 'yalla-ready',
    ...config.taskSystem.blockLabels,
    ...config.taskSystem.priorityLabels,
    ...config.autopilot.eligibleLabels,
    ...config.autopilot.blockLabels,
  ].filter(Boolean))
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function runTemplate(rootDir: string, loadedConfig: LoadedYallaConfig, apply: boolean): OnboardResult {
  const target = resolve(rootDir, loadedConfig.config.taskSystem.issueTemplate || '.github/ISSUE_TEMPLATE/yalla-task.md')
  if (apply) {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, readFileSync(templateSource(), 'utf8'))
  }
  return { exitCode: 0, templateTarget: target, applied: apply }
}

async function runDashboard(rootDir: string, loadedConfig: LoadedYallaConfig, commandRunner: CommandRunner): Promise<OnboardResult> {
  const checkResult = await runCheck(rootDir, loadedConfig, commandRunner)
  const labelsResult =
    (loadedConfig.config.trackingMode ?? 'github') === 'github'
      ? await runLabels(rootDir, loadedConfig, commandRunner, false)
      : { exitCode: 0, missingLabels: [], commands: [], applied: false }
  const templateResult = runTemplate(rootDir, loadedConfig, false)
  const dashboardPath = writeDashboard(rootDir, loadedConfig, checkResult, labelsResult, templateResult)
  return {
    exitCode: checkResult.exitCode,
    checks: checkResult.checks,
    missingLabels: labelsResult.missingLabels,
    commands: labelsResult.commands,
    templateTarget: templateResult.templateTarget,
    dashboardPath,
    applied: false,
  }
}

function writeDashboard(rootDir: string, loadedConfig: LoadedYallaConfig, checkResult: OnboardResult, labelsResult: OnboardResult, templateResult: OnboardResult) {
  const pipelineDir = resolve(rootDir, '.pipeline')
  mkdirSync(pipelineDir, { recursive: true })
  const path = resolve(pipelineDir, 'yalla-onboarding-dashboard.html')
  writeFileSync(path, renderDashboard(rootDir, loadedConfig, checkResult, labelsResult, templateResult))
  return path
}

function renderDashboard(rootDir: string, loadedConfig: LoadedYallaConfig, checkResult: OnboardResult, labelsResult: OnboardResult, templateResult: OnboardResult) {
  const checks = checkResult.checks ?? []
  const done = checks.filter(check => check.status === 'pass').length
  const warnings = checks.filter(check => check.status === 'warn').length
  const failures = checks.filter(check => check.status === 'fail').length
  const total = Math.max(checks.length, 1)
  const percent = Math.round((done / total) * 100)
  const missingLabels = labelsResult.missingLabels ?? []
  const commands = labelsResult.commands ?? []
  const templateTarget = templateResult.templateTarget ? relative(rootDir, templateResult.templateTarget) || templateResult.templateTarget : 'not resolved'
  const openCommand = `open ${resolve(rootDir, '.pipeline/yalla-onboarding-dashboard.html')}`
  const beforeYalla = checks.filter(check => ['config', 'base_branch', 'tracking_mode', 'commands.test', 'test_dir'].includes(check.name))
  const beforeAutopilot = checks.filter(check => ['github_auth', 'github_labels', 'autopilot_default'].includes(check.name))

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Yalla Onboarding Dashboard</title>
  <style>
    :root { color-scheme: light; --ink:#101010; --paper:#f6f2e8; --accent:#ff5a1f; --ok:#0f7b3f; --warn:#b26a00; --fail:#b00020; --line:#101010; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width:1100px; margin:0 auto; padding:32px 20px 48px; }
    .hero { border:3px solid var(--line); background:#fff; box-shadow:8px 8px 0 var(--line); padding:28px; display:grid; gap:18px; grid-template-columns:1fr; }
    h1 { font-size:clamp(32px, 7vw, 76px); line-height:.9; margin:0; letter-spacing:-0.06em; text-transform:uppercase; }
    h2 { margin:0 0 14px; font-size:22px; text-transform:uppercase; letter-spacing:-0.03em; }
    .meta { display:flex; flex-wrap:wrap; gap:10px; }
    .pill { border:2px solid var(--line); padding:8px 10px; background:#fff7cc; font-weight:800; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:18px; margin-top:28px; }
    .card { border:3px solid var(--line); background:#fff; padding:18px; box-shadow:5px 5px 0 var(--line); }
    .score { font-size:56px; font-weight:950; line-height:1; letter-spacing:-0.06em; }
    .bar { height:22px; border:2px solid var(--line); background:#eee; margin-top:12px; }
    .bar > div { height:100%; width:${percent}%; background:var(--accent); }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { border:2px solid var(--line); padding:10px; text-align:left; vertical-align:top; }
    th { background:#111; color:#fff; text-transform:uppercase; }
    .status { font-weight:900; text-transform:uppercase; }
    .pass { color:var(--ok); } .warn { color:var(--warn); } .fail { color:var(--fail); }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    pre { white-space:pre-wrap; overflow:auto; background:#111; color:#fff; border:2px solid var(--line); padding:14px; }
    .next { background:#ffe1d5; }
  </style>
</head>
<body>
<main>
  <section class="hero">
    <div>
      <h1>Yalla Onboarding</h1>
      <p>Project readiness snapshot. Use this to see what is configured, what is missing, and what to do next.</p>
      <pre>${escapeHtml(openCommand)}</pre>
    </div>
    <div class="meta">
      <span class="pill">Project: ${escapeHtml(loadedConfig.config.projectName || 'unknown')}</span>
      <span class="pill">Root: ${escapeHtml(rootDir)}</span>
      <span class="pill">Config: ${escapeHtml(loadedConfig.path ?? 'missing')}</span>
      <span class="pill">Tracking: ${escapeHtml(loadedConfig.config.trackingMode ?? 'github')}</span>
    </div>
  </section>

  <section class="grid">
    <div class="card"><h2>Readiness</h2><div class="score">${percent}%</div><div class="bar"><div></div></div></div>
    <div class="card"><h2>Done</h2><div class="score pass">${done}</div></div>
    <div class="card"><h2>Warnings</h2><div class="score warn">${warnings}</div></div>
    <div class="card"><h2>Missing</h2><div class="score fail">${failures}</div></div>
  </section>

  <section class="card" style="margin-top:28px">
    <h2>Required Before First /yalla</h2>
    ${renderCheckTable(beforeYalla)}
  </section>

  <section class="card" style="margin-top:28px">
    <h2>Required Before Autopilot</h2>
    ${renderCheckTable(beforeAutopilot)}
  </section>

  <section class="card" style="margin-top:28px">
    <h2>All Checks</h2>
    ${renderCheckTable(checks)}
  </section>

  <section class="grid">
    <div class="card">
      <h2>Labels</h2>
      ${missingLabels.length ? `<p>Missing labels:</p><pre>${escapeHtml(missingLabels.join('\n'))}</pre><p>Create commands:</p><pre>${escapeHtml(commands.join('\n'))}</pre>` : '<p class="pass status">All required labels present or skipped.</p>'}
    </div>
    <div class="card">
      <h2>Issue Template</h2>
      <p>Target:</p><pre>${escapeHtml(templateTarget)}</pre>
      <p>Dry-run:</p><pre>${escapeHtml(`npm run yalla:onboard -- template --dry-run --config ${loadedConfig.path ?? '.claude/YALLA.md'}`)}</pre>
      <p>Apply with:</p><pre>${escapeHtml(`npm run yalla:onboard -- template --apply --config ${loadedConfig.path ?? '.claude/YALLA.md'}`)}</pre>
    </div>
  </section>

  <section class="card next" style="margin-top:28px">
    <h2>Next Best Step</h2>
    <p>${escapeHtml(nextStep(checks, missingLabels, loadedConfig))}</p>
  </section>
</main>
</body>
</html>
`
}

function renderCheckTable(checks: Check[]) {
  if (!checks.length) return '<p>No checks in this section.</p>'
  return `<table><thead><tr><th>Item</th><th>Status</th><th>Detail</th></tr></thead><tbody>
      ${checks.map(check => `<tr><td>${escapeHtml(check.name)}</td><td class="status ${check.status}">${check.status}</td><td>${escapeHtml(check.detail)}</td></tr>`).join('')}
    </tbody></table>`
}

function nextStep(checks: Check[], missingLabels: string[], loadedConfig: LoadedYallaConfig) {
  const failed = checks.find(check => check.status === 'fail')
  if (failed) return `Fix ${failed.name}: ${failed.detail}`
  if (missingLabels.length && (loadedConfig.config.trackingMode ?? 'github') === 'github') return 'Create the missing GitHub labels, or keep running in file-only mode until the repo is ready.'
  if (!loadedConfig.config.autopilot.enabled) return 'Run one manual /yalla task before enabling any scheduled autopilot mode.'
  return 'Configuration is ready. Keep autopilot at dry-run/report-only until the readiness checklist passes.'
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char))
}

function templateSource() {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  return resolve(currentDir, '../docs/onboarding/templates/yalla-task.md')
}

async function main() {
  const result = await runYallaOnboard(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = result.exitCode
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
