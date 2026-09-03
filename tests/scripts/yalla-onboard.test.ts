import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runYallaOnboard } from '../../scripts/yalla-onboard.js'

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'yalla-onboard-'))
}

function writeConfig(root: string, content = '') {
  mkdirSync(join(root, '.claude'), { recursive: true })
  writeFileSync(
    join(root, '.claude', 'YALLA.md'),
    content || `repo: "owner/repo"
base_branch: main
tracking_mode: github
test_dir: tests/
commands:
  test: "npm test"
  typecheck: "npm run typecheck"
  build: "npm run build"
  lint: "npm run lint"
models:
  classify: "cheap"
  implement: "sonnet"
  review: "opus"
verifiers:
  api: "npm test"
  visual: ".pipeline/visual-evidence/"
task_system:
  ready_label: yalla-ready
  block_labels: [blocked, needs-human]
  priority_labels: [p0, p1]
  issue_template: ".github/ISSUE_TEMPLATE/yalla-task.md"
autopilot:
  enabled: false
  level: L0
risk_gates:
  - name: payment-integrity-check
    triggers_on: [payments]
`
  )
}

describe('scripts/yalla-onboard.ts', () => {
  it('checks config, commands, auth, labels, and autopilot defaults', async () => {
    const root = tempRoot()
    mkdirSync(join(root, 'tests'))
    writeConfig(root)
    const result = await runYallaOnboard({
      command: 'check',
      rootDir: root,
      commandRunner: async (_command, args) => {
        if (args[0] === 'auth') return { stdout: 'logged in', stderr: '', exitCode: 0 }
        return { stdout: JSON.stringify([{ name: 'yalla-ready' }, { name: 'blocked' }, { name: 'needs-human' }, { name: 'p0' }, { name: 'p1' }]), stderr: '', exitCode: 0 }
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'config', status: 'pass' }), expect.objectContaining({ name: 'github_labels', status: 'pass' })]))
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'risk_gates', status: 'pass' })]))
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'model_routing', status: 'pass' })]))
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'verifier_registry', status: 'pass' })]))
  })

  it('fails onboarding when a configured risk gate is not canonical', async () => {
    const root = tempRoot()
    mkdirSync(join(root, 'tests'))
    writeConfig(root, `repo: "owner/repo"
base_branch: main
tracking_mode: github
test_dir: tests/
commands:
  test: "npm test"
  typecheck: "npm run typecheck"
  build: "npm run build"
  lint: "npm run lint"
risk_gates:
  - name: generated-artifacts-check
    triggers_on: [repo-generator]
`)
    const result = await runYallaOnboard({
      command: 'check',
      rootDir: root,
      commandRunner: async (_command, args) => {
        if (args[0] === 'auth') return { stdout: 'logged in', stderr: '', exitCode: 0 }
        return { stdout: JSON.stringify([]), stderr: '', exitCode: 0 }
      },
    })

    expect(result.exitCode).toBe(1)
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'risk_gates', status: 'fail', detail: expect.stringContaining('generated-artifacts-check') })]))
  })

  it('labels dry-run reports missing create commands without mutation', async () => {
    const root = tempRoot()
    writeConfig(root)
    const calls: string[] = []
    const result = await runYallaOnboard({
      command: 'labels',
      rootDir: root,
      commandRunner: async (command, args) => {
        calls.push([command, ...args].join(' '))
        return { stdout: JSON.stringify([{ name: 'blocked' }]), stderr: '', exitCode: 0 }
      },
    })

    expect(result.missingLabels).toEqual(['yalla-ready', 'needs-human', 'p0', 'p1'])
    expect(result.commands?.[0]).toContain('gh label create yalla-ready')
    expect(calls).toEqual(['gh label list --json name --repo owner/repo'])
    expect(result.applied).toBe(false)
  })

  it('template apply writes the issue template to configured target', async () => {
    const root = tempRoot()
    writeConfig(root)
    const result = await runYallaOnboard({ command: 'template', rootDir: root, apply: true })

    expect(result.applied).toBe(true)
    expect(result.templateTarget).toBe(join(root, '.github/ISSUE_TEMPLATE/yalla-task.md'))
    expect(existsSync(result.templateTarget ?? '')).toBe(true)
    expect(readFileSync(result.templateTarget ?? '', 'utf8')).toContain('## Acceptance Criteria')
  })

  it('template dry-run targets the project root inferred from an absolute config path', async () => {
    const root = tempRoot()
    writeConfig(root)
    const result = await runYallaOnboard({ command: 'template', configPath: join(root, '.claude/YALLA.md') })

    expect(result.templateTarget).toBe(join(root, '.github/ISSUE_TEMPLATE/yalla-task.md'))
    expect(result.applied).toBe(false)
  })

  it('skips label checks when tracking mode is file-only', async () => {
    const root = tempRoot()
    mkdirSync(join(root, 'tests'))
    writeConfig(root, `base_branch: main
tracking_mode: file-only
test_dir: tests/
commands:
  test: "npm test"
  typecheck: ""
  build: "npm run build"
  lint: "npm run lint"
`)
    const result = await runYallaOnboard({
      command: 'check',
      rootDir: root,
      commandRunner: async (_command, args) => {
        if (args[0] === 'auth') return { stdout: 'logged in', stderr: '', exitCode: 0 }
        throw new Error('label list should not run')
      },
    })

    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'github_labels', status: 'pass', detail: 'Skipped for tracking_mode=file-only' })]))
  })

  it('supports Linear tracking config without requiring GitHub labels', async () => {
    const root = tempRoot()
    mkdirSync(join(root, 'tests'))
    writeConfig(root, `base_branch: main
tracking_mode: linear
test_dir: tests/
commands:
  test: "npm test"
  typecheck: ""
  build: "npm run build"
  lint: "npm run lint"
task_system:
  provider: linear
  team: CAP
  ready_states: [Ready, Selected]
  in_progress_state: "In Progress"
  review_state: "In Review"
  blocked_state: "Needs Human"
  done_state: Done
`)
    const result = await runYallaOnboard({
      command: 'check',
      rootDir: root,
      commandRunner: async (_command, args) => {
        if (args[0] === 'auth') return { stdout: 'logged in', stderr: '', exitCode: 0 }
        throw new Error('label list should not run for Linear tracking')
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'tracking_mode', status: 'pass', detail: 'linear' })]))
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'task_system_provider', status: 'pass', detail: expect.stringContaining('Linear provider configured') })]))
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'github_labels', status: 'pass', detail: 'Skipped for tracking_mode=linear' })]))
  })

  it('dashboard writes a visual onboarding html report', async () => {
    const root = tempRoot()
    mkdirSync(join(root, 'tests'))
    writeConfig(root)
    const result = await runYallaOnboard({
      command: 'dashboard',
      rootDir: root,
      commandRunner: async (_command, args) => {
        if (args[0] === 'auth') return { stdout: 'logged in', stderr: '', exitCode: 0 }
        return { stdout: JSON.stringify([{ name: 'blocked' }]), stderr: '', exitCode: 0 }
      },
    })

    expect(result.dashboardPath).toBe(join(root, '.pipeline/yalla-onboarding-dashboard.html'))
    expect(existsSync(result.dashboardPath ?? '')).toBe(true)
    const html = readFileSync(result.dashboardPath ?? '', 'utf8')
    expect(html).toContain('Yalla Onboarding')
    expect(html).toContain('Required Before First /yalla')
    expect(html).toContain('Required Before Autopilot')
    expect(html).toContain('open ')
    expect(html).toContain('Missing labels')
    expect(html).toContain('gh label create yalla-ready')
  })

  it('init behaves as the one-command dashboard path', async () => {
    const root = tempRoot()
    mkdirSync(join(root, 'tests'))
    writeConfig(root)
    const result = await runYallaOnboard({
      command: 'init',
      rootDir: root,
      commandRunner: async (_command, args) => {
        if (args[0] === 'auth') return { stdout: 'logged in', stderr: '', exitCode: 0 }
        return { stdout: JSON.stringify([]), stderr: '', exitCode: 0 }
      },
    })

    expect(result.dashboardPath).toBe(join(root, '.pipeline/yalla-onboarding-dashboard.html'))
    expect(existsSync(result.dashboardPath ?? '')).toBe(true)
  })

  it('dashboard skips missing label card for file-only tracking', async () => {
    const root = tempRoot()
    mkdirSync(join(root, 'tests'))
    writeConfig(root, `base_branch: main
tracking_mode: file-only
test_dir: tests/
commands:
  test: "npm test"
  typecheck: ""
  build: "npm run build"
  lint: "npm run lint"
`)
    const result = await runYallaOnboard({
      command: 'dashboard',
      rootDir: root,
      commandRunner: async (_command, args) => {
        if (args[0] === 'auth') return { stdout: 'logged in', stderr: '', exitCode: 0 }
        throw new Error('label list should not run')
      },
    })

    const html = readFileSync(result.dashboardPath ?? '', 'utf8')
    expect(result.missingLabels).toEqual([])
    expect(html).toContain('All required labels present or skipped.')
  })
})
