import { describe, expect, it } from 'vitest'
import { runTestInventoryFixtures, loadTestInventoryFixtures } from '../../eval/yalla/runner/test-inventory-runner.js'
import { validateTestInventory } from '../../eval/yalla/schemas/test-inventory.js'

const completeCategories = [
  'payment',
  'auth-security',
  'async-jobs',
  'generated-artifacts',
  'ui-journeys',
  'browser-interactions',
  'task-tracking',
  'schema-migration',
] as const

function validEntry(category: (typeof completeCategories)[number]) {
  return {
    category,
    description: `${category} tests`,
    deterministic_seam_available: true,
    proof_mode: category === 'ui-journeys' || category === 'browser-interactions' ? 'playwright' : 'existing-test',
    verdict: 'PROVEN',
    verification_strength: 'strong',
    commands: [`npm run test -- tests/${category}`],
    existing_tests: [`tests/${category}/example.test.ts`],
    coverage_gaps: [],
  }
}

function validInventory() {
  return {
    inventory_version: 1,
    generated_from: 'test',
    categories: completeCategories.map(validEntry),
  }
}

describe('yalla test inventory', () => {
  it('passes the current inventory and fixture suite', () => {
    const report = runTestInventoryFixtures()

    expect(report.passed).toBe(true)
    expect(report.summary.inventory_valid).toBe(true)
    expect(report.summary.fixtures_passed).toBe(true)
    expect(Object.keys(report.categories)).toEqual([...completeCategories])
  })

  it('can run against a mock adapter without filesystem reads', () => {
    const report = runTestInventoryFixtures({
      readInventory: validInventory,
      readFixtures: () => [{ id: 'mock-valid', expected_valid: true, input: validInventory(), loader_rejected: false }],
      fileExists: () => true,
      readPackageScripts: () => ({ test: 'vitest run' }),
    })

    expect(report.passed).toBe(true)
    expect(report.fixtures[0].id).toBe('mock-valid')
  })

  it('hides sealed rubrics before evaluation', () => {
    const rawFixtures = [
      {
        id: 'sealed',
        expected_valid: true,
        sealed_rubric: { judge_notes: 'hidden answer key' },
        input: validInventory(),
      },
    ]

    const loaded = loadTestInventoryFixtures(rawFixtures)

    expect(JSON.stringify(loaded)).not.toContain('sealed_rubric')
    expect(JSON.stringify(loaded)).not.toContain('judge_notes')
    expect(loaded[0]).toEqual({ id: 'sealed', expected_valid: true, input: validInventory(), loader_rejected: false })
  })

  it('rejects secret-bearing fixtures before exposing their input', () => {
    const loaded = loadTestInventoryFixtures([
      {
        id: 'secret-fixture',
        expected_valid: false,
        sealed_rubric: { judge_notes: 'hidden answer key' },
        input: { inventory_version: 1, generated_from: 'SBF_FAKE_SECRET_TEST_VALUE', categories: [] },
      },
    ])

    expect(loaded[0]).toEqual({ id: 'secret-fixture', expected_valid: false, loader_rejected: true })
    expect(JSON.stringify(loaded)).not.toContain('SBF_FAKE_SECRET_TEST_VALUE')
  })

  it('rejects likely secrets anywhere in inventory input', () => {
    const inventory = validInventory()
    inventory.generated_from = 'SBF_FAKE_SECRET_TEST_VALUE'

    const result = validateTestInventory(inventory)

    expect(result.valid).toBe(false)
    expect(result.violations.some(violation => violation.message.includes('likely secret'))).toBe(true)
  })

  it('rejects likely secrets hidden in unknown fields before schema parsing', () => {
    const inventory = { ...validInventory(), unknown_field: 'SBF_FAKE_SECRET_TEST_VALUE' }

    const result = validateTestInventory(inventory)

    expect(result.valid).toBe(false)
    expect(result.violations.some(violation => violation.message.includes('likely secret'))).toBe(true)
  })

  it('fails the runner when referenced test files or npm scripts do not exist', () => {
    const report = runTestInventoryFixtures({
      readInventory: validInventory,
      readFixtures: () => [{ id: 'mock-valid', expected_valid: true, input: validInventory(), loader_rejected: false }],
      fileExists: path => !path.includes('payment'),
      readPackageScripts: () => ({}),
    })

    expect(report.passed).toBe(false)
    expect(report.violations.some(violation => violation.message.includes('Referenced test file does not exist'))).toBe(true)
    expect(report.violations.some(violation => violation.message.includes('Referenced npm script does not exist'))).toBe(
      true
    )
  })

  it('requires every PRD 02 category to be represented', () => {
    const inventory = validInventory()
    inventory.categories = inventory.categories.filter(entry => entry.category !== 'payment')

    const result = validateTestInventory(inventory)

    expect(result.valid).toBe(false)
    expect(result.categories.payment).toBe('MISSING')
    expect(result.violations.map(violation => violation.message)).toContain('Missing required category: payment.')
  })

  it('requires each category to map to tests or explicit gaps', () => {
    const inventory = validInventory()
    inventory.categories[0].existing_tests = []
    inventory.categories[0].coverage_gaps = []

    const result = validateTestInventory(inventory)

    expect(result.valid).toBe(false)
    expect(result.violations.some(violation => violation.message.includes('existing tests or explicit coverage gaps'))).toBe(
      true
    )
  })

  it('does not allow deterministic seams to require model judges', () => {
    const inventory = validInventory()
    inventory.categories[0].proof_mode = 'model-judge'

    const result = validateTestInventory(inventory)

    expect(result.valid).toBe(false)
    expect(result.violations.map(violation => violation.message)).toContain(
      'Model judges are forbidden when deterministic seams exist.'
    )
  })

  it('does not allow weak or missing verification commands to be PROVEN', () => {
    const weakInventory = validInventory()
    weakInventory.categories[0].verification_strength = 'weak'

    const missingInventory = validInventory()
    missingInventory.categories[0].commands = []

    const weak = validateTestInventory(weakInventory)
    const missing = validateTestInventory(missingInventory)

    expect(weak.valid).toBe(false)
    expect(weak.violations.map(violation => violation.message)).toContain('PROVEN requires strong verification commands.')
    expect(missing.valid).toBe(false)
    expect(missing.violations.map(violation => violation.message)).toContain('PROVEN requires at least one command.')
  })
})
