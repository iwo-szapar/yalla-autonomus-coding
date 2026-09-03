import test from 'node:test'
import assert from 'node:assert/strict'
import { buildInstructions, resolveMode } from '../instructions.js'

test('resolves supported modes and aliases', () => {
  assert.equal(resolveMode('lean'), 'lean')
  assert.equal(resolveMode('normal'), 'standard')
  assert.equal(resolveMode('off'), 'standard')
})

test('builds compact yalla instructions', () => {
  const instructions = buildInstructions('strict')

  assert.match(instructions, /YALLA MODE ACTIVE - strict/)
  assert.match(instructions, /Only `PROVEN` may be described as done/)
  assert.match(instructions, /minimum-diff ladder/)
})
