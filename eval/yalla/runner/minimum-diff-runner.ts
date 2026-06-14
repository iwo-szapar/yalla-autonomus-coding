import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateMinimumDiffSample } from '../schemas/minimum-diff.js'

type Fixture = {
  id: string
  priority: string
  source: string
  legacy_should_fail: boolean
  patched_should_pass: boolean
  legacy: unknown
  patched: unknown
}

function loadFixtures(): Fixture[] {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  return JSON.parse(readFileSync(resolve(currentDir, '../data/minimum-diff-fixtures.json'), 'utf8')) as Fixture[]
}

export function runMinimumDiffFixtures(fixtures = loadFixtures()) {
  const results = fixtures.map(fixture => {
    const legacy = validateMinimumDiffSample(fixture.legacy)
    const patched = validateMinimumDiffSample(fixture.patched)

    return {
      id: fixture.id,
      priority: fixture.priority,
      source: fixture.source,
      legacy_failed_as_expected: fixture.legacy_should_fail ? !legacy.valid : legacy.valid,
      patched_passed_as_expected: fixture.patched_should_pass ? patched.valid : !patched.valid,
      legacy_violations: legacy.violations.length,
      patched_violations: patched.violations.length,
    }
  })

  const beforePatchFailures = results.filter(result => result.legacy_failed_as_expected && result.legacy_violations > 0).length
  const passed = fixtures.length > 0 && beforePatchFailures > 0 && results.every(result => result.legacy_failed_as_expected && result.patched_passed_as_expected)

  return {
    passed,
    summary: {
      total: results.length,
      p0: results.filter(result => result.priority === 'P0').length,
      before_patch_failures: beforePatchFailures,
      legacy_failing: results.every(result => result.legacy_failed_as_expected),
      patched_passing: results.every(result => result.patched_passed_as_expected),
    },
    results,
  }
}

function main() {
  const report = runMinimumDiffFixtures()
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
