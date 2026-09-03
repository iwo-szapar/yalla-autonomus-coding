import { z } from 'zod'

export const inventoryCategorySchema = z.enum([
  'payment',
  'auth-security',
  'async-jobs',
  'generated-artifacts',
  'ui-journeys',
  'browser-interactions',
  'task-tracking',
  'schema-migration',
])

export const inventoryVerdictSchema = z.enum(['PROVEN', 'NOT_PROVEN', 'INCONCLUSIVE'])

export const verificationStrengthSchema = z.enum(['strong', 'weak', 'missing'])

export const inventoryProofModeSchema = z.enum([
  'existing-test',
  'new-test',
  'playwright',
  'static-artifact',
  'manual-smoke',
  'model-judge',
  'inconclusive',
])

const testPathSchema = z.string().min(1).regex(/^(tests|eval)\//)
const likelySecretPattern = /((sk_(live|test)|gh[oprsu]|re|sbk)_[A-Za-z0-9]{12,}|SBF_FAKE_SECRET_[A-Za-z0-9_]+|-----BEGIN [A-Z ]+PRIVATE KEY-----)/

export const inventoryEntrySchema = z.object({
  category: inventoryCategorySchema,
  description: z.string().min(1),
  deterministic_seam_available: z.boolean(),
  proof_mode: inventoryProofModeSchema,
  verdict: inventoryVerdictSchema,
  verification_strength: verificationStrengthSchema,
  commands: z.array(z.string().min(1)).default([]),
  existing_tests: z.array(testPathSchema).default([]),
  coverage_gaps: z.array(z.string().min(1)).default([]),
  notes: z.string().min(1).optional(),
})

export const testInventorySchema = z.object({
  inventory_version: z.literal(1),
  generated_from: z.string().min(1),
  categories: z.array(inventoryEntrySchema).min(1),
})

export type InventoryCategory = z.infer<typeof inventoryCategorySchema>
export type TestInventory = z.infer<typeof testInventorySchema>

export type TestInventoryViolation = {
  path: string
  message: string
}

export type TestInventoryValidation = {
  valid: boolean
  verdict: z.infer<typeof inventoryVerdictSchema>
  violations: TestInventoryViolation[]
  categories: Record<InventoryCategory, z.infer<typeof inventoryVerdictSchema> | 'MISSING'>
}

const requiredCategories = inventoryCategorySchema.options

function addViolation(violations: TestInventoryViolation[], path: string, message: string) {
  violations.push({ path, message })
}

export function containsLikelySecret(value: unknown): boolean {
  if (typeof value === 'string') {
    return likelySecretPattern.test(value)
  }

  if (Array.isArray(value)) {
    return value.some(item => containsLikelySecret(item))
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(item => containsLikelySecret(item))
  }

  return false
}

function summarizeCategories(categories: TestInventory['categories'] | undefined) {
  const summary = Object.fromEntries(requiredCategories.map(category => [category, 'MISSING'])) as Record<
    InventoryCategory,
    z.infer<typeof inventoryVerdictSchema> | 'MISSING'
  >

  for (const entry of categories ?? []) {
    summary[entry.category] = entry.verdict
  }

  return summary
}

export function validateTestInventory(input: unknown): TestInventoryValidation {
  if (containsLikelySecret(input)) {
    return {
      valid: false,
      verdict: 'NOT_PROVEN',
      violations: [{ path: '<root>', message: 'Inventory contains a likely secret and cannot be evaluated.' }],
      categories: summarizeCategories(undefined),
    }
  }

  const parseResult = testInventorySchema.safeParse(input)
  if (!parseResult.success) {
    return {
      valid: false,
      verdict: 'NOT_PROVEN',
      violations: parseResult.error.issues.map(issue => ({
        path: issue.path.join('.') || '<root>',
        message: issue.message,
      })),
      categories: summarizeCategories(undefined),
    }
  }

  const inventory = parseResult.data
  const violations: TestInventoryViolation[] = []
  const seen = new Set<InventoryCategory>()

  for (const category of requiredCategories) {
    if (!inventory.categories.some(entry => entry.category === category)) {
      addViolation(violations, 'categories', `Missing required category: ${category}.`)
    }
  }

  inventory.categories.forEach((entry, index) => {
    if (seen.has(entry.category)) {
      addViolation(violations, `categories.${index}.category`, `Duplicate category: ${entry.category}.`)
    }
    seen.add(entry.category)

    if (entry.existing_tests.length === 0 && entry.coverage_gaps.length === 0) {
      addViolation(
        violations,
        `categories.${entry.category}`,
        'Each category must map to existing tests or explicit coverage gaps.'
      )
    }

    if (entry.deterministic_seam_available && entry.proof_mode === 'model-judge') {
      addViolation(
        violations,
        `categories.${entry.category}.proof_mode`,
        'Model judges are forbidden when deterministic seams exist.'
      )
    }

    if (entry.verdict === 'PROVEN' && entry.verification_strength !== 'strong') {
      addViolation(
        violations,
        `categories.${entry.category}.verification_strength`,
        'PROVEN requires strong verification commands.'
      )
    }

    if (entry.verdict === 'PROVEN' && entry.commands.length === 0) {
      addViolation(violations, `categories.${entry.category}.commands`, 'PROVEN requires at least one command.')
    }

    if (entry.verdict === 'PROVEN' && entry.existing_tests.length === 0) {
      addViolation(violations, `categories.${entry.category}.existing_tests`, 'PROVEN requires existing test evidence.')
    }
  })

  return {
    valid: violations.length === 0,
    verdict: violations.length === 0 ? 'PROVEN' : 'NOT_PROVEN',
    violations,
    categories: summarizeCategories(inventory.categories),
  }
}
