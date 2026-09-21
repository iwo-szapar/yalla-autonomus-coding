import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  acquireRunLock,
  artifactFreshness,
  assertWorktreeCleanupSafe,
  bindArtifact,
  createCandidateIdentity,
  completeOperationReceipt,
  detectPathOverlaps,
  findUnownedChangedPaths,
  normalizePathClaims,
  recordOperationReceipt,
  recordRemoteJob,
  releaseRunLock,
  requiredCapabilityForCommand,
  routeFailure,
  validateCandidate,
  validatePathAttribution,
  writeCandidate,
} from '../../scripts/yalla-control.js'
import { loadReleaseAdapter, releaseAdapterSchema } from '../../scripts/yalla-release-adapter.js'

function gitRoot() {
  const root = mkdtempSync(join(tmpdir(), 'yalla-control-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Yalla Test'], { cwd: root })
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/owner/repo.git'], { cwd: root })
  mkdirSync(join(root, '.claude'), { recursive: true })
  mkdirSync(join(root, '.pipeline'), { recursive: true })
  writeFileSync(join(root, '.claude/YALLA.md'), 'repo: owner/repo\nbase_branch: main\n')
  writeFileSync(join(root, '.pipeline/goal-contract.json'), JSON.stringify({ version: 1, desired_end_state: 'safe candidate' }))
  writeFileSync(join(root, 'app.ts'), 'export const value = 1\n')
  execFileSync('git', ['add', 'app.ts', '.claude/YALLA.md'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: root })
  return root
}

function candidate(root: string) {
  return createCandidateIdentity({
    rootDir: root,
    repository: 'owner/repo',
    baseBranch: 'main',
    runId: 'run-1',
    issueId: 'issue-47',
    now: () => '2026-09-20T12:00:00.000Z',
  })
}

describe('candidate integrity control plane', () => {
  it('binds a candidate to exact Git, contract, config, and policy state', () => {
    const root = gitRoot()
    const created = candidate(root)
    writeCandidate(root, created)

    expect(validateCandidate(created, { rootDir: root, repository: 'owner/repo', baseBranch: 'main' })).toMatchObject({ state: 'RESUMABLE_EXACT', reasons: [] })

    writeFileSync(join(root, 'app.ts'), 'export const value = 2\n')
    expect(validateCandidate(created, { rootDir: root, repository: 'owner/repo', baseBranch: 'main' })).toMatchObject({ state: 'RESUMABLE_AFTER_REVALIDATION', reasons: ['working-tree fingerprint changed'] })

    execFileSync('git', ['add', 'app.ts'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'change'], { cwd: root })
    expect(validateCandidate(created, { rootDir: root, repository: 'owner/repo', baseBranch: 'main' }).state).toBe('SUPERSEDED')
  })

  it('keeps the candidate ID stable when immutable inputs have not changed', () => {
    const root = gitRoot()
    const first = candidate(root)
    const second = createCandidateIdentity({
      rootDir: root,
      repository: 'owner/repo',
      baseBranch: 'main',
      runId: 'run-1',
      issueId: 'issue-47',
      now: () => '2026-09-20T13:00:00.000Z',
    })
    expect(second.created_at).not.toBe(first.created_at)
    expect(second.candidate_id).toBe(first.candidate_id)
  })

  it('keeps auto-detected candidate identity valid after JSON persistence', () => {
    const root = gitRoot()
    const created = createCandidateIdentity({ rootDir: root, baseBranch: 'main', runId: 'run-1', issueId: 'issue-47' })
    writeCandidate(root, created)
    const persisted = JSON.parse(readFileSync(join(root, '.pipeline/candidate.json'), 'utf8'))
    expect(validateCandidate(persisted, { rootDir: root, baseBranch: 'main' })).toMatchObject({ state: 'RESUMABLE_EXACT' })
  })

  it('detects content changes even when the same file was already dirty', () => {
    const root = gitRoot()
    writeFileSync(join(root, 'app.ts'), 'export const value = 2\n')
    const created = candidate(root)
    writeFileSync(join(root, 'app.ts'), 'export const value = 3\n')
    expect(validateCandidate(created, { rootDir: root, repository: 'owner/repo', baseBranch: 'main' })).toMatchObject({
      state: 'RESUMABLE_AFTER_REVALIDATION',
      reasons: ['working-tree fingerprint changed'],
    })
  })

  it('requires revalidation after contract, config, or trust-root drift', () => {
    const root = gitRoot()
    writeFileSync(join(root, 'AGENTS.md'), 'Initial policy\n')
    execFileSync('git', ['add', 'AGENTS.md'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'policy'], { cwd: root })
    const created = candidate(root)

    writeFileSync(join(root, 'AGENTS.md'), 'Changed policy\n')
    const validation = validateCandidate(created, { rootDir: root, repository: 'owner/repo', baseBranch: 'main' })
    expect(validation.state).toBe('RESUMABLE_AFTER_REVALIDATION')
    expect(validation.reasons).toEqual(expect.arrayContaining(['working-tree fingerprint changed', 'trust-root policy changed']))
  })

  it('stops on worktree branch identity mismatch and incompatible schema', () => {
    const root = gitRoot()
    const created = candidate(root)
    execFileSync('git', ['switch', '-c', 'other-branch'], { cwd: root })
    expect(validateCandidate(created, { rootDir: root, repository: 'owner/repo', baseBranch: 'main' }).state).toBe('IDENTITY_MISMATCH')
    expect(validateCandidate({ ...created, schema_version: 999 }, { rootDir: root, repository: 'owner/repo', baseBranch: 'main' }).state).toBe('INCOMPATIBLE_SCHEMA')
  })

  it('rejects a candidate whose address was edited without re-minting', () => {
    const root = gitRoot()
    const created = candidate(root)
    expect(validateCandidate({ ...created, issue_id: 'issue-99' }, { rootDir: root, repository: 'owner/repo', baseBranch: 'main' }).state).toBe('IDENTITY_MISMATCH')
  })

  it('rejects a declared repository mismatch and an unresolvable base branch', () => {
    const root = gitRoot()
    expect(() => createCandidateIdentity({ rootDir: root, repository: 'other/repo', baseBranch: 'main' })).toThrow('does not match observed origin')
    expect(() => createCandidateIdentity({ rootDir: root, repository: 'owner/repo', baseBranch: 'missing-base' })).toThrow('Unable to resolve a Git base SHA')
  })

  it('rejects stale evaluator artifacts from another candidate', () => {
    const root = gitRoot()
    const first = candidate(root)
    const document = bindArtifact({ result: 'pass' }, first, 'test', [], () => '2026-09-20T12:00:00.000Z')
    expect(artifactFreshness(document, first).status).toBe('CURRENT')

    writeFileSync(join(root, 'app.ts'), 'export const value = 3\n')
    execFileSync('git', ['add', 'app.ts'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'new candidate'], { cwd: root })
    const second = candidate(root)
    expect(artifactFreshness(document, second)).toMatchObject({ status: 'STALE' })
  })

  it('invalidates an artifact when one of its declared inputs changes', () => {
    const root = gitRoot()
    const created = candidate(root)
    const document = bindArtifact({ result: 'pass' }, created, 'test', ['app.ts'])
    expect(artifactFreshness(document, created).status).toBe('CURRENT')
    writeFileSync(join(root, 'app.ts'), 'export const value = 9\n')
    expect(artifactFreshness(document, created)).toMatchObject({ status: 'STALE', reason: 'artifact input changed: app.ts' })
  })

  it('invalidates an artifact when its bound content is edited', () => {
    const root = gitRoot()
    const created = candidate(root)
    const document = bindArtifact({ verdict: 'NOT_PROVEN' }, created, 'test')
    expect(artifactFreshness(document, created).status).toBe('CURRENT')
    expect(artifactFreshness({ ...document, verdict: 'PROVEN' }, created)).toMatchObject({ status: 'STALE', reason: 'artifact content changed after binding' })
  })

  it('invalidates an artifact when its dependency metadata is edited or removed', () => {
    const root = gitRoot()
    const created = candidate(root)
    const document = bindArtifact({ verdict: 'PROVEN' }, created, 'test', ['app.ts'])
    expect(artifactFreshness({ ...document, _meta: { ...document._meta, input_digests: {} } }, created)).toMatchObject({ status: 'STALE', reason: 'artifact binding metadata changed after binding' })
    const { input_digests: _removed, ...withoutInputs } = document._meta
    expect(artifactFreshness({ ...document, _meta: withoutInputs }, created)).toMatchObject({ status: 'INCOMPATIBLE' })
  })

  it('uses a fail-closed single-writer lock', () => {
    const root = gitRoot()
    const first = acquireRunLock(root, 'first')
    expect(() => acquireRunLock(root, 'second')).toThrow('already held by first')
    releaseRunLock(first)
    expect(existsSync(join(root, '.pipeline/run.lock'))).toBe(false)
  })

  it('routes failure classes without treating every failure as a repair loop', () => {
    expect(routeFailure('CANDIDATE_FAILURE')).toBe('repair-candidate')
    expect(routeFailure('BASELINE_FAILURE')).toBe('separate-baseline-repair')
    expect(routeFailure('INFRA_ERROR')).toBe('retry-same-candidate')
    expect(routeFailure('IDENTITY_MISMATCH')).toBe('stop-identity')
    expect(routeFailure('POLICY_BLOCKED')).toBe('stop-policy')
    expect(routeFailure('SUPERSEDED')).toBe('discard-superseded')
  })

  it('requires explicit capabilities, refuses protected authorization, and deduplicates receipts', () => {
    const root = gitRoot()
    const created = candidate(root)
    expect(() => recordOperationReceipt({
      rootDir: root,
      candidate: created,
      allowedCapabilities: ['read_repo', 'write_worktree'],
      operationId: 'open-denied',
      capability: 'open_pr',
      action: 'open',
      target: 'pr-1',
    })).toThrow('Capability open_pr is not granted')

    expect(() => recordOperationReceipt({
      rootDir: root,
      candidate: created,
      allowedCapabilities: ['read_repo', 'write_worktree'],
      operationId: 'merge-2',
      capability: 'merge_pr',
      action: 'merge',
      target: 'pr-2',
    })).toThrow('cannot be authorized by the local Yalla runner')

    const recorded = recordOperationReceipt({
      rootDir: root,
      candidate: created,
      allowedCapabilities: ['read_repo', 'write_worktree', 'open_pr'],
      operationId: 'open-1',
      capability: 'open_pr',
      action: 'open',
      target: 'pr-for-issue-47',
      now: () => '2026-09-20T12:01:00.000Z',
    })
    const duplicate = recordOperationReceipt({
      rootDir: root,
      candidate: created,
      allowedCapabilities: ['read_repo', 'write_worktree', 'open_pr'],
      operationId: 'open-1',
      capability: 'open_pr',
      action: 'open',
      target: 'pr-for-issue-47',
    })
    expect(recorded.status).toBe('recorded')
    expect(duplicate.status).toBe('duplicate')
    writeFileSync(join(root, 'app.ts'), 'export const value = 2\n')
    expect(completeOperationReceipt({
      rootDir: root,
      operationId: 'open-1',
      capability: 'open_pr',
      action: 'open',
      target: 'pr-for-issue-47',
      status: 'succeeded',
    }).status).toBe('updated')
    const receipts = JSON.parse(readFileSync(join(root, '.pipeline/operation-receipts.json'), 'utf8'))
    expect(receipts.receipts).toHaveLength(1)
    expect(receipts.receipts[0].status).toBe('succeeded')
    expect(receipts.receipts[0].execution_authority).toBe('local-configured-capability')
  })

  it('maps known privileged commands to typed capabilities', () => {
    expect(requiredCapabilityForCommand('git', ['push', 'origin', 'branch'])).toBe('push_branch')
    expect(requiredCapabilityForCommand('gh', ['pr', 'merge', '47'])).toBe('merge_pr')
    expect(requiredCapabilityForCommand('vercel', ['deploy', '--prod'])).toBe('deploy_production')
    expect(requiredCapabilityForCommand('supabase', ['db', 'push'])).toBe('apply_migrations')
    expect(requiredCapabilityForCommand('gh', ['issue', 'view', '47'])).toBeUndefined()
  })

  it('detects only declared parallel path ownership overlap', () => {
    expect(detectPathOverlaps([
      { owner: 'implementer', paths: ['src/api'] },
      { owner: 'tester', paths: ['tests/api'] },
    ])).toEqual([])
    expect(detectPathOverlaps([
      { owner: 'one', paths: ['src/api'] },
      { owner: 'two', paths: ['src/api/checkout.ts'] },
    ])).toEqual([{ owners: ['one', 'two'], paths: ['src/api', 'src/api/checkout.ts'] }])
  })

  it('rejects path aliases and finds changed files outside declared ownership', () => {
    const root = gitRoot()
    expect(() => normalizePathClaims(root, [{ owner: 'one', paths: ['src/../app.ts'] }])).toThrow('must be canonical')
    expect(() => normalizePathClaims(root, [{ owner: 'one', paths: ['../outside'] }])).toThrow('repository-relative')
    expect(findUnownedChangedPaths(['src/a.ts', 'tests/a.test.ts'], [{ owner: 'one', paths: ['src'] }])).toEqual(['tests/a.test.ts'])
    expect(() => normalizePathClaims(root, [{ owner: 'one', paths: ['src'], changed_paths: ['tests/a.test.ts'] }])).toThrow('outside its declared paths')
    expect(() => validatePathAttribution(['src/a.ts'], [
      { owner: 'one', paths: ['src'], changed_paths: [] },
      { owner: 'two', paths: ['tests'], changed_paths: [] },
    ])).not.toThrow()
    expect(validatePathAttribution(['src/a.ts'], [
      { owner: 'one', paths: ['src'], changed_paths: [] },
      { owner: 'two', paths: ['tests'], changed_paths: [] },
    ])).toMatchObject({ unattributed: ['src/a.ts'] })
  })

  it('refuses cleanup of dirty worktrees while ignoring local pipeline state', () => {
    const root = gitRoot()
    writeCandidate(root, candidate(root))
    expect(assertWorktreeCleanupSafe(root)).toMatchObject({ safe: true })
    writeFileSync(join(root, 'app.ts'), 'uncommitted\n')
    expect(() => assertWorktreeCleanupSafe(root)).toThrow('Dirty worktree cleanup refused')
  })

  it('records candidate-bound remote build and artifact-reuse telemetry idempotently', () => {
    const root = gitRoot()
    const created = candidate(root)
    expect(recordRemoteJob({ rootDir: root, candidate: created, operationId: 'build-1', kind: 'production-build', artifactAction: 'built', status: 'pending', durationSeconds: 0, cost: undefined }).status).toBe('recorded')
    expect(recordRemoteJob({ rootDir: root, candidate: created, operationId: 'build-1', kind: 'production-build', artifactAction: 'built', status: 'pending', durationSeconds: 0 }).status).toBe('duplicate')
    expect(recordRemoteJob({ rootDir: root, candidate: created, operationId: 'build-1', kind: 'production-build', artifactAction: 'built', status: 'succeeded', durationSeconds: 600, cost: 1.2 }).status).toBe('updated')
    expect(recordRemoteJob({ rootDir: root, candidate: created, operationId: 'smoke-1', kind: 'smoke', artifactAction: 'reused', status: 'pending', durationSeconds: 0 }).status).toBe('recorded')
    expect(recordRemoteJob({ rootDir: root, candidate: created, operationId: 'smoke-1', kind: 'smoke', artifactAction: 'reused', status: 'succeeded', durationSeconds: 120 }).status).toBe('updated')
    const telemetry = JSON.parse(readFileSync(join(root, '.pipeline/remote-jobs.json'), 'utf8'))
    expect(telemetry.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ execution_authority: 'none-local-telemetry-only' })]))
    expect(telemetry.summary).toEqual({ attempts: 2, remote_jobs: 2, pending: 0, succeeded: 2, failed: 0, blocked: 0, builds: 1, artifact_reuses: 1, duration_seconds: 720, known_cost: 1.2 })
  })
})

describe('portable release adapter', () => {
  const validAdapter = {
    schema_version: 1,
    tier: 'T2',
    project_identity: { repository: 'owner/repo', project_id: 'immutable-project-id', team_id: 'team-id', target: 'production-candidate' },
    dependencies: [{ kind: 'git-revision', name: 'upstream-api', version: '0123456789abcdef0123456789abcdef01234567', environment: 'staging' }],
    commands: {
      preflight: 'npm run release:preflight',
      focused_checks: ['npm run test:focused'],
      full_checks: ['npm test'],
      smoke_assertions: ['page marker is present', 'checkout response matches contract'],
    },
    protected_capabilities: ['deploy_production', 'promote_production'],
    budgets: { max_remote_jobs_per_candidate: 4, max_full_suites_per_candidate: 1, max_production_builds_per_candidate: 1 },
  }

  it('accepts a provider-neutral T1/T2 adapter', () => {
    expect(releaseAdapterSchema.parse(validAdapter)).toMatchObject({ tier: 'T2', project_identity: { project_id: 'immutable-project-id' } })
  })

  it('rejects incomplete adapters and loads valid files deterministically', () => {
    expect(releaseAdapterSchema.safeParse({ schema_version: 1, tier: 'T1' }).success).toBe(false)
    expect(releaseAdapterSchema.safeParse({ ...validAdapter, protected_capabilities: ['read_repo'] }).success).toBe(false)
    for (const version of ['latest', 'stable', 'beta', 'release', 'v1', '1.2']) {
      expect(releaseAdapterSchema.safeParse({ ...validAdapter, dependencies: [{ kind: 'semver', name: 'api', version, environment: 'staging' }] }).success).toBe(false)
    }
    expect(releaseAdapterSchema.safeParse({ ...validAdapter, dependencies: [{ kind: 'git-revision', name: 'api', version: 'main', environment: 'staging' }] }).success).toBe(false)
    expect(releaseAdapterSchema.safeParse({ ...validAdapter, dependencies: [{ kind: 'semver', name: 'api', version: '1.2.3', environment: 'staging' }] }).success).toBe(true)
    expect(releaseAdapterSchema.safeParse({ ...validAdapter, dependencies: [{ kind: 'content-digest', name: 'api', version: `sha256:${'a'.repeat(64)}`, environment: 'staging' }] }).success).toBe(true)
    const root = mkdtempSync(join(tmpdir(), 'yalla-adapter-'))
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(join(root, '.claude/release-adapter.json'), JSON.stringify(validAdapter))
    expect(loadReleaseAdapter(root, '.claude/release-adapter.json')).toMatchObject({ ok: true })
  })
})
