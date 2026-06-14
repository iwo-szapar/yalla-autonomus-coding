import { fileURLToPath } from 'node:url'
import { runMinimumDiffFixtures } from '../eval/yalla/runner/minimum-diff-runner.js'
import { runYallaSmoke } from '../eval/yalla/runner/smoke-runner.js'

export function runYallaBenchmark() {
  const minimumDiff = runMinimumDiffFixtures()
  const smoke = runYallaSmoke()
  return {
    passed: minimumDiff.passed && smoke.passed,
    metrics: {
      minimum_diff_fixtures: minimumDiff.summary,
      proof_smoke: smoke,
    },
    note: 'Fixture benchmark scaffold. Add replay data under benchmarks/yalla/ as real runs accumulate.',
  }
}

function main() {
  const report = runYallaBenchmark()
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
