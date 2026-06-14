const fs = require('fs')
const path = require('path')
const { DEFAULT_MODE, getDefaultMode, normalizeMode } = require('./yalla-config.cjs')

const ROOT = path.join(__dirname, '..')
const AGENTS_PATH = path.join(ROOT, 'AGENTS.md')

const MODE_NOTES = {
  lean: [
    'YALLA MODE ACTIVE - lean',
    'Use the proof contract, but prefer tiny-hotfix/minimal evidence when safe. Run the minimum-diff ladder before planning and avoid committed routine artifacts.',
  ].join('\n\n'),
  standard: [
    'YALLA MODE ACTIVE - standard',
    'Use the normal adaptive pipeline. Run minimum-diff classification, then proof, test, review, and PR-only shipping discipline.',
  ].join('\n\n'),
  strict: [
    'YALLA MODE ACTIVE - strict',
    'Use strict evidence posture. Require hostile self-critique, intent brief, acceptance trace, test evidence, risk-triggered review, and explicit simplification notes.',
  ].join('\n\n'),
}

function getBaseInstructions() {
  try {
    return fs.readFileSync(AGENTS_PATH, 'utf8').trim()
  } catch (_) {
    return 'Yalla: prove the user-visible promise with the smallest safe diff. Only PROVEN is done.'
  }
}

function getYallaInstructions(mode) {
  const effectiveMode = normalizeMode(mode) || getDefaultMode() || DEFAULT_MODE
  if (effectiveMode === 'off') return ''
  return [MODE_NOTES[effectiveMode] || MODE_NOTES.standard, getBaseInstructions()].join('\n\n')
}

module.exports = {
  getBaseInstructions,
  getYallaInstructions,
}
