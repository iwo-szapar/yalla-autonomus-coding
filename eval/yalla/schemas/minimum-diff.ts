import { z } from 'zod'

const rungSchema = z.enum([
  'no-build',
  'config-docs',
  'existing-code',
  'stdlib-native',
  'installed-dependency',
  'one-local-change',
  'new-implementation',
])

const allowedComplexitySchema = z.object({
  item: z.string().min(1),
  why_safe_to_skip: z.string().min(1),
  add_when: z.string().min(1),
})

export const minimumDiffSampleSchema = z.object({
  selected_rung: rungSchema,
  higher_rungs_checked: z.array(rungSchema).default([]),
  existing_targets_checked: z.array(z.string().min(1)).default([]),
  stdlib_native_checked: z.array(z.string().min(1)).default([]),
  installed_dependencies_checked: z.array(z.string().min(1)).default([]),
  new_dependencies: z.array(z.string().min(1)).default([]),
  new_abstractions: z.array(z.string().min(1)).default([]),
  files_budget: z.number().int().nonnegative(),
  files_changed: z.number().int().nonnegative(),
  loc_budget: z.number().int().nonnegative(),
  loc_changed: z.number().int().nonnegative(),
  skipped_complexity: z.array(allowedComplexitySchema).default([]),
})

export type MinimumDiffSample = z.infer<typeof minimumDiffSampleSchema>

export type MinimumDiffViolation = {
  path: string
  message: string
}

export type MinimumDiffValidation = {
  valid: boolean
  violations: MinimumDiffViolation[]
}

const rungOrder = [
  'no-build',
  'config-docs',
  'existing-code',
  'stdlib-native',
  'installed-dependency',
  'one-local-change',
  'new-implementation',
] as const

function addViolation(violations: MinimumDiffViolation[], path: string, message: string) {
  violations.push({ path, message })
}

function higherRungs(selectedRung: MinimumDiffSample['selected_rung']) {
  return rungOrder.slice(0, rungOrder.indexOf(selectedRung))
}

function hasSkippedJustification(sample: MinimumDiffSample, item: string) {
  return sample.skipped_complexity.some(entry => entry.item.toLowerCase().includes(item))
}

export function validateMinimumDiffSample(input: unknown): MinimumDiffValidation {
  const parsed = minimumDiffSampleSchema.safeParse(input)
  if (!parsed.success) {
    return {
      valid: false,
      violations: parsed.error.issues.map(issue => ({
        path: issue.path.join('.') || '<root>',
        message: issue.message,
      })),
    }
  }

  const sample = parsed.data
  const violations: MinimumDiffViolation[] = []
  const requiredHigherRungs = higherRungs(sample.selected_rung)

  for (const rung of requiredHigherRungs) {
    if (!sample.higher_rungs_checked.includes(rung)) {
      addViolation(violations, 'higher_rungs_checked', `Missing higher-rung check before ${sample.selected_rung}: ${rung}.`)
    }
  }

  if (['installed-dependency', 'one-local-change', 'new-implementation'].includes(sample.selected_rung)) {
    if (sample.existing_targets_checked.length === 0) {
      addViolation(violations, 'existing_targets_checked', 'Minimum-diff gate must check existing local code before adding new behavior.')
    }
    if (sample.stdlib_native_checked.length === 0) {
      addViolation(violations, 'stdlib_native_checked', 'Minimum-diff gate must check stdlib/native options before adding new behavior.')
    }
  }

  if (['installed-dependency', 'one-local-change', 'new-implementation'].includes(sample.selected_rung) && sample.installed_dependencies_checked.length === 0) {
    addViolation(violations, 'installed_dependencies_checked', 'Minimum-diff gate must check already-installed dependencies before later rungs.')
  }

  if (sample.new_dependencies.length > 0) {
    addViolation(violations, 'new_dependencies', 'Minimum-diff gate rejects new dependencies; installed-dependency means already present in the repo.')
  }

  if (sample.new_abstractions.length > 0 && !hasSkippedJustification(sample, 'abstraction')) {
    addViolation(violations, 'new_abstractions', 'New abstractions require an explicit simplification note or second real implementation case.')
  }

  if (sample.files_changed > sample.files_budget) {
    addViolation(violations, 'files_changed', `Changed ${sample.files_changed} files, over budget ${sample.files_budget}.`)
  }

  if (sample.loc_changed > sample.loc_budget) {
    addViolation(violations, 'loc_changed', `Changed ${sample.loc_changed} LOC, over budget ${sample.loc_budget}.`)
  }

  return {
    valid: violations.length === 0,
    violations,
  }
}
