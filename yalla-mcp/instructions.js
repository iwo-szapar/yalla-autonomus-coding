import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { getYallaInstructions } = require('../hooks/yalla-instructions.cjs')
const { getDefaultMode, normalizeMode } = require('../hooks/yalla-config.cjs')

export const MODES = ['lean', 'standard', 'strict']

export function resolveMode(requested) {
  const asked = normalizeMode(requested)
  if (asked && asked !== 'off') return asked

  const fallback = normalizeMode(getDefaultMode())
  return fallback && fallback !== 'off' ? fallback : 'standard'
}

export function buildInstructions(requested) {
  return getYallaInstructions(resolveMode(requested))
}
