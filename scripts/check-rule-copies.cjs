#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/\r\n/g, '\n').trim()
}

function stripYamlFrontmatter(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n*/, '').trim()
}

const canonical = read('AGENTS.md')
const copies = [
  ['.cursor/rules/yalla.mdc', stripYamlFrontmatter],
  ['.windsurf/rules/yalla.md', text => text.trim()],
  ['.clinerules/yalla.md', text => text.trim()],
  ['.github/copilot-instructions.md', text => text.trim()],
  ['.kiro/steering/yalla.md', stripYamlFrontmatter],
]

let failed = false

for (const [relPath, normalize] of copies) {
  const actual = normalize(read(relPath))
  if (actual !== canonical) {
    console.error(`${relPath} drifted from AGENTS.md`)
    failed = true
  }
}

const invariants = [
  'Only `PROVEN` may be described as done',
  'minimum-diff ladder',
  'Tests cross public seams',
  'Default shipping policy is PR-only',
  'Never minimize away input validation',
]

for (const phrase of invariants) {
  if (!canonical.includes(phrase)) {
    console.error(`AGENTS.md is missing invariant: ${phrase}`)
    failed = true
  }
}

if (failed) {
  console.error('Update AGENTS.md or the copied rule files so adapter rules stay aligned.')
  process.exit(1)
}

console.log(`Rule copies match AGENTS.md; ${invariants.length} invariants present.`)
