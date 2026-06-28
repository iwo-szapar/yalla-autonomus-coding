import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildRemoteShellCommand,
  createLocalSandbox,
  doctor,
  isExcluded,
  matchesExclude,
  parseIssueId,
  removeLocalSandbox,
  selectVerificationProfile,
  validateConfig,
  verify,
} from '../../scripts/agent-sandbox.js'

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'yalla-agent-sandbox-test-'))
}

function writeConfig(rootDir: string, commands = ['node -e "process.exit(0)"']) {
  writeFileSync(
    resolve(rootDir, 'agent-sandbox.config.json'),
    JSON.stringify(
      {
        defaultProvider: 'local',
        workspacePath: '/workspace/test',
        sync: {
          exclude: ['node_modules/', '.git/', '.pipeline/', '.env*', 'scripts/profiles/*.json', 'tests/playwright/.auth/'],
        },
        envAllowlist: ['NODE_ENV', 'CI'],
        profiles: {
          fast: { commands },
          'ui-smoke': { commands },
          mcp: { commands },
          schema: { commands },
          money: { commands },
          delivery: { commands },
        },
      },
      null,
      2
    )
  )
}

function cleanup(path: string) {
  rmSync(path, { recursive: true, force: true })
}

describe('scripts/agent-sandbox.ts', () => {
  it('validates config and rejects unsafe sync rules', () => {
    expect(() =>
      validateConfig({
        defaultProvider: 'local',
        workspacePath: '/workspace/test',
        sync: { exclude: ['node_modules/'] },
        envAllowlist: [],
        profiles: { fast: { commands: ['npm test'] } },
      })
    ).toThrow('Config must exclude .env* files.')
  })

  it('matches sync excludes for directories and globs', () => {
    expect(matchesExclude('node_modules/pkg/index.js', 'node_modules/')).toBe(true)
    expect(matchesExclude('.env.local', '.env*')).toBe(true)
    expect(matchesExclude('scripts/profiles/customer.json', 'scripts/profiles/*.json')).toBe(true)
    expect(isExcluded('src/App.tsx', ['node_modules/', '.env*'])).toBe(false)
  })

  it('rejects non-canonical issue ids', () => {
    expect(parseIssueId('issue-123')).toBe('issue-123')
    expect(() => parseIssueId('123')).toThrow('Issue must use canonical issue-### format.')
  })

  it('routes changed files to the strictest verification profile', () => {
    expect(selectVerificationProfile(['docs/testing/README.md'])).toBe('fast')
    expect(selectVerificationProfile(['src/pages/CheckoutPage.tsx'])).toBe('money')
    expect(selectVerificationProfile(['api/mcp.ts'])).toBe('mcp')
    expect(selectVerificationProfile(['lib/db/migrations/120_example.sql'])).toBe('schema')
    expect(selectVerificationProfile(['lib/repo-generator/orchestrator.ts'])).toBe('delivery')
  })

  it('builds Crabbox remote commands with dependency and DB setup boundaries', () => {
    expect(buildRemoteShellCommand('fast', ['npm ci'], ['bash scripts/agent-sandbox/setup-local-supabase.sh'], ['npm test'])).toBe('npm ci && npm test')
    expect(buildRemoteShellCommand('schema', ['npm ci'], ['bash scripts/agent-sandbox/setup-local-supabase.sh'], ['npm run migrate:dry'])).toContain(
      'npm ci && bash scripts/agent-sandbox/setup-local-supabase.sh && if [ -f .pipeline/local-supabase-mapped.env ]; then'
    )
  })

  it('creates a local sandbox without excluded files and tears it down idempotently', () => {
    const root = tempRoot()
    try {
      writeConfig(root)
      writeFileSync(resolve(root, 'visible.txt'), 'hello')
      writeFileSync(resolve(root, '.env.local'), 'SHOULD_NOT_SYNC=1')

      const state = createLocalSandbox(root, 'issue-123', validateConfig(JSON.parse(readFileSync(resolve(root, 'agent-sandbox.config.json'), 'utf8'))))

      expect(existsSync(resolve(state.path, 'visible.txt'))).toBe(true)
      expect(existsSync(resolve(state.path, '.env.local'))).toBe(false)
      expect(removeLocalSandbox(root, 'issue-123')).toMatchObject({ status: 'pass' })
      expect(removeLocalSandbox(root, 'issue-123')).toMatchObject({ status: 'pass', message: 'already-removed' })
    } finally {
      cleanup(root)
    }
  })

  it('runs fast verification in a local sandbox and writes PROVEN proof', async () => {
    const root = tempRoot()
    try {
      writeConfig(root, ['node -e "const fs=require(\'fs\'); if(!fs.existsSync(\'untracked.txt\')) process.exit(2)"'])
      writeFileSync(resolve(root, 'untracked.txt'), 'present')

      const result = await verify({ issue: 'issue-123', profile: 'fast', rootDir: root, keepAlive: false })
      const proof = JSON.parse(readFileSync(result.proofPath, 'utf8')) as { verdict: string; artifacts: Array<{ path: string }> }

      expect(proof.verdict).toBe('PROVEN')
      expect(proof.artifacts.length).toBeGreaterThan(0)
      expect(proof.artifacts.every(artifact => artifact.path.startsWith('.pipeline/agent-sandbox-artifacts/'))).toBe(true)
    } finally {
      cleanup(root)
    }
  })

  it('writes NOT_PROVEN proof when a sandbox command fails', async () => {
    const root = tempRoot()
    try {
      writeConfig(root, ['node -e "process.exit(7)"'])

      const result = await verify({ issue: 'issue-123', profile: 'fast', rootDir: root, keepAlive: false })
      const proof = JSON.parse(readFileSync(result.proofPath, 'utf8')) as { verdict: string; commands: Array<{ exit_code: number }> }

      expect(proof.verdict).toBe('NOT_PROVEN')
      expect(proof.commands[0].exit_code).toBe(7)
    } finally {
      cleanup(root)
    }
  })

  it('doctor passes for a valid local config', async () => {
    const root = tempRoot()
    try {
      writeConfig(root)

      await expect(doctor(root)).resolves.toMatchObject({ status: 'pass', provider: 'local' })
    } finally {
      cleanup(root)
    }
  })
})
