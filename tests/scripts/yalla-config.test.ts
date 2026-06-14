import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inferConfigRoot, loadYallaConfig, parseYallaConfig } from '../../scripts/yalla-config.js'

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'yalla-config-'))
}

afterEach(() => {
  delete process.env.YALLA_CONFIG_PATH
})

describe('scripts/yalla-config.ts', () => {
  it('parses documented config sections used by onboarding and autopilot', () => {
    const config = parseYallaConfig(`
repo: "example/repo"
project_name: example
base_branch: main
tracking_mode: github
test_dir: tests/

commands:
  test: "npm test"
  typecheck: ""

models:
  classify: "cheap"
  review: "opus"

verifiers:
  api: "npm test"
  visual: ".pipeline/visual-evidence/"

task_system:
  ready_label: ready-for-ai
  block_labels: [blocked, needs-human]
  priority_labels: [p0, p1, p2]
  issue_template: ".github/ISSUE_TEMPLATE/yalla-task.md"

autopilot:
  enabled: false
  level: L0
  human_mode: strict
  block_labels: [do-not-autopilot]
  max_iterations: 4
  max_runtime_minutes: 60
  token_budget: "100k"
  auto_merge: false

evals:
  smoke_command: "npm run eval:yalla:smoke"
  project_fixtures_required_before_autopilot: true

ceremony:
  default_mode: lean
  allow_user_override: true
  minimum_diff_default_files_budget: 3
  minimum_diff_default_loc_budget: 120
`)

    expect(config.repo).toBe('example/repo')
    expect(config.commands.test).toBe('npm test')
    expect(config.commands.typecheck).toBe('')
    expect(config.models.review).toBe('opus')
    expect(config.verifiers.api).toBe('npm test')
    expect(config.taskSystem.readyLabel).toBe('ready-for-ai')
    expect(config.taskSystem.blockLabels).toEqual(['blocked', 'needs-human'])
    expect(config.autopilot.eligibleLabels).toEqual(['ready-for-ai'])
    expect(config.autopilot.blockLabels).toEqual(['do-not-autopilot'])
    expect(config.autopilot.maxIterations).toBe(4)
    expect(config.autopilot.maxRuntimeMinutes).toBe(60)
    expect(config.autopilot.tokenBudget).toBe('100k')
    expect(config.autopilot.enabled).toBe(false)
    expect(config.evals.projectFixturesRequiredBeforeAutopilot).toBe(true)
    expect(config.ceremony.defaultMode).toBe('lean')
    expect(config.ceremony.allowUserOverride).toBe(true)
    expect(config.ceremony.minimumDiffDefaultFilesBudget).toBe(3)
    expect(config.ceremony.minimumDiffDefaultLocBudget).toBe(120)
  })

  it('loads explicit config paths relative to root dir', () => {
    const root = tempRoot()
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(join(root, '.claude', 'YALLA.md'), 'repo: "owner/repo"\nbase_branch: main\n')

    const loaded = loadYallaConfig({ rootDir: root, configPath: '.claude/YALLA.md' })

    expect(loaded.source).toBe('explicit')
    expect(loaded.path).toBe(join(root, '.claude', 'YALLA.md'))
    expect(loaded.rootDir).toBe(root)
    expect(loaded.config.repo).toBe('owner/repo')
  })

  it('infers target root from absolute .claude/YALLA.md paths', () => {
    const root = tempRoot()
    const configPath = join(root, '.claude', 'YALLA.md')

    expect(inferConfigRoot(configPath)).toBe(root)
  })

  it('uses YALLA_CONFIG_PATH when no explicit path is provided', () => {
    const root = tempRoot()
    mkdirSync(join(root, 'config'), { recursive: true })
    writeFileSync(join(root, 'config', 'YALLA.md'), 'repo: "env/repo"\n')
    process.env.YALLA_CONFIG_PATH = 'config/YALLA.md'

    const loaded = loadYallaConfig({ rootDir: root })

    expect(loaded.source).toBe('env')
    expect(loaded.config.repo).toBe('env/repo')
  })
})
