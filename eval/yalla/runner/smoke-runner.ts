import { fileURLToPath } from 'node:url'
import { runMinimumDiffFixtures } from './minimum-diff-runner.js'
import { runOutcomeQuality } from './outcome-quality.js'
import { runPlanReviewCoverageFixtures } from './plan-review-coverage-runner.js'
import { runProofContractFixtures } from './proof-contract-runner.js'
import { runTestInventoryFixtures } from './test-inventory-runner.js'

export function runYallaSmoke() {
  const proofContract = runProofContractFixtures()
  const testInventory = runTestInventoryFixtures()
  const minimumDiff = runMinimumDiffFixtures()
  const planReviewCoverage = runPlanReviewCoverageFixtures()
  const outcomeQuality = runOutcomeQuality()
  const passed = proofContract.passed && testInventory.passed && minimumDiff.passed && planReviewCoverage.passed && outcomeQuality.passed

  return {
    passed,
    proof_contract: proofContract.summary,
    test_inventory: testInventory.summary,
    minimum_diff: minimumDiff.summary,
    plan_review_coverage: planReviewCoverage.summary,
    outcome_quality: outcomeQuality.summary,
  }
}

function main() {
  const report = runYallaSmoke()
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) {
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
