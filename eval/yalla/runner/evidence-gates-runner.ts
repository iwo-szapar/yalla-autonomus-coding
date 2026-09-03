import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateEvidenceGates } from '../schemas/evidence-gates.js'

type Fixture = {
  id: string
  priority: string
  held_out: boolean
  source: string
  legacy_should_fail: boolean
  patched_should_pass: boolean
  legacy: unknown
  patched: unknown
}

function loadFixtures(): Fixture[] {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  return JSON.parse(readFileSync(resolve(currentDir, '../data/evidence-gates-fixtures.json'), 'utf8')) as Fixture[]
}

export function runEvidenceGateFixtures(fixtures = loadFixtures()) {
  const results = fixtures.map(fixture => {
    const legacy = validateEvidenceGates(fixture.legacy)
    const patched = validateEvidenceGates(fixture.patched)

    return {
      id: fixture.id,
      priority: fixture.priority,
      held_out: fixture.held_out,
      source: fixture.source,
      legacy_failed_as_expected: fixture.legacy_should_fail ? legacy.length > 0 : legacy.length === 0,
      patched_passed_as_expected: fixture.patched_should_pass ? patched.length === 0 : patched.length > 0,
      legacy_violations: legacy.length,
      patched_violations: patched.length,
    }
  })

  const p0 = results.filter(result => result.priority === 'P0')
  const heldOut = results.filter(result => result.held_out)
  const beforePatchFailures = p0.filter(result => result.legacy_failed_as_expected && result.legacy_violations > 0).length
  const p0LegacyFailing = p0.every(result => result.legacy_failed_as_expected)
  const p0PatchedPassing = p0.every(result => result.patched_passed_as_expected)
  const heldOutPassing = heldOut.every(result => result.legacy_failed_as_expected && result.patched_passed_as_expected)

  return {
    passed: beforePatchFailures > 0 && p0LegacyFailing && p0PatchedPassing && heldOutPassing,
    summary: {
      total: results.length,
      p0: p0.length,
      before_patch_failures: beforePatchFailures,
      p0_legacy_failing: p0LegacyFailing,
      p0_patched_passing: p0PatchedPassing,
      held_out_passing: heldOutPassing,
    },
    results,
  }
}

function main() {
  const report = runEvidenceGateFixtures()
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
