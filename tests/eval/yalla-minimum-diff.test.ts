import { describe, expect, it } from 'vitest'
import { runMinimumDiffFixtures } from '../../eval/yalla/runner/minimum-diff-runner.js'
import { validateMinimumDiffSample } from '../../eval/yalla/schemas/minimum-diff.js'

describe('minimum-diff eval', () => {
  it('rejects over-built legacy fixtures and accepts patched fixtures', () => {
    const report = runMinimumDiffFixtures()

    expect(report.passed).toBe(true)
    expect(report.summary.before_patch_failures).toBeGreaterThan(0)
    expect(report.results.every(result => result.legacy_failed_as_expected)).toBe(true)
    expect(report.results.every(result => result.patched_passed_as_expected)).toBe(true)
  })

  it('requires higher rungs before new implementation', () => {
    const result = validateMinimumDiffSample({
      selected_rung: 'new-implementation',
      higher_rungs_checked: ['no-build'],
      existing_targets_checked: [],
      stdlib_native_checked: [],
      installed_dependencies_checked: [],
      new_dependencies: [],
      new_abstractions: [],
      files_budget: 2,
      files_changed: 1,
      loc_budget: 50,
      loc_changed: 20,
      skipped_complexity: [],
    })

    expect(result.valid).toBe(false)
    expect(result.violations.map(violation => violation.path)).toContain('higher_rungs_checked')
    expect(result.violations.map(violation => violation.path)).toContain('existing_targets_checked')
    expect(result.violations.map(violation => violation.path)).toContain('stdlib_native_checked')
  })

  it('rejects new dependencies even when installed-dependency rung is selected', () => {
    const result = validateMinimumDiffSample({
      selected_rung: 'installed-dependency',
      higher_rungs_checked: ['no-build', 'config-docs', 'existing-code', 'stdlib-native'],
      existing_targets_checked: ['src/lib/date.ts'],
      stdlib_native_checked: ['Intl.DateTimeFormat'],
      installed_dependencies_checked: ['date-fns'],
      new_dependencies: ['date-fns'],
      new_abstractions: [],
      files_budget: 1,
      files_changed: 1,
      loc_budget: 20,
      loc_changed: 8,
      skipped_complexity: [],
    })

    expect(result.valid).toBe(false)
    expect(result.violations.map(violation => violation.path)).toContain('new_dependencies')
  })

  it('requires installed dependency checks before one-local-change', () => {
    const result = validateMinimumDiffSample({
      selected_rung: 'one-local-change',
      higher_rungs_checked: ['no-build', 'config-docs', 'existing-code', 'stdlib-native', 'installed-dependency'],
      existing_targets_checked: ['src/lib/parser.ts'],
      stdlib_native_checked: ['URLSearchParams'],
      installed_dependencies_checked: [],
      new_dependencies: [],
      new_abstractions: [],
      files_budget: 1,
      files_changed: 1,
      loc_budget: 20,
      loc_changed: 8,
      skipped_complexity: [],
    })

    expect(result.valid).toBe(false)
    expect(result.violations.map(violation => violation.path)).toContain('installed_dependencies_checked')
  })
})
