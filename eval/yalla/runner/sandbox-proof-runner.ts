import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateSandboxProof } from '../schemas/sandbox-proof.js'

type SandboxProofFixture = {
  id: string
  expected_valid: boolean
  proof: unknown
}

export function runSandboxProofFixtures() {
  const fixtures = JSON.parse(readFileSync(new URL('../data/sandbox-proof-fixtures.json', import.meta.url), 'utf8')) as SandboxProofFixture[]
  const results = fixtures.map(fixture => {
    const validation = validateSandboxProof(fixture.proof)
    return {
      id: fixture.id,
      expected_valid: fixture.expected_valid,
      valid: validation.valid,
      matched_expectation: validation.valid === fixture.expected_valid,
      violations: validation.violations.length,
    }
  })
  const passed = results.every(result => result.matched_expectation)
  return {
    passed,
    summary: {
      total: fixtures.length,
      passed: results.filter(result => result.valid).length,
      failed: results.filter(result => !result.valid).length,
      fixtures_matched: passed,
    },
    results,
  }
}

function main() {
  const report = runSandboxProofFixtures()
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
