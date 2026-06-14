import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

type Frontmatter = Record<string, string>

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function listFiles(root: string, predicate: (path: string) => boolean): string[] {
  const entries = readdirSync(root, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return listFiles(path, predicate)
    return predicate(path) ? [path] : []
  })
}

function markdownFiles(...roots: string[]) {
  return roots.flatMap((root) => listFiles(join(repoRoot, root), (path) => path.endsWith('.md')))
}

function parseFrontmatter(path: string): Frontmatter {
  const content = readFileSync(path, 'utf8')
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  if (!match) throw new Error(`${relative(repoRoot, path)} is missing frontmatter`)

  const data: Frontmatter = {}
  let currentKey = ''
  for (const line of match[1].split('\n')) {
    const keyValue = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/)
    if (keyValue) {
      currentKey = keyValue[1]
      data[currentKey] = keyValue[2].replace(/^>\s*$/, '').trim()
      continue
    }

    if (currentKey && /^\s+\S/.test(line)) {
      data[currentKey] = `${data[currentKey]} ${line.trim()}`.trim()
    }
  }

  return data
}

function extractRefs(content: string, prefix: string): string[] {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`${escapedPrefix}([^\\s\`)\\],]+)`, 'g')
  return Array.from(content.matchAll(regex), (match) => match[1].replace(/[.,;:]+$/, ''))
}

function resolveRef(root: string, ref: string): boolean {
  if (ref.includes('$')) return true

  if (ref.includes('*')) {
    const [beforeStar, afterStar = ''] = ref.split('*')
    const dir = beforeStar.endsWith('/') ? join(root, beforeStar) : join(root, dirname(beforeStar))
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return false
    const suffix = afterStar.replace(/^\//, '')
    return readdirSync(dir).some((entry) => !suffix || entry.endsWith(suffix))
  }

  return existsSync(join(root, ref))
}

describe('Claude Code plugin contract', () => {
  it('keeps plugin, marketplace, and package metadata aligned', () => {
    const plugin = readJson(join(repoRoot, '.claude-plugin/plugin.json'))
    const codex = readJson(join(repoRoot, '.codex-plugin/plugin.json'))
    const gemini = readJson(join(repoRoot, 'gemini-extension.json'))
    const marketplace = readJson(join(repoRoot, '.claude-plugin/marketplace.json'))
    const pkg = readJson(join(repoRoot, 'package.json'))

    expect(plugin).toMatchObject({ name: 'yalla', license: 'MIT' })
    expect(plugin.version).toBe(pkg.version)
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(plugin.description.length).toBeGreaterThan(80)
    expect(plugin.author.name).toBe('Iwo Szapar')
    expect(plugin.homepage).toBe('https://github.com/iwo-szapar/yalla')
    expect(plugin.repository).toBe('https://github.com/iwo-szapar/yalla')
    expect(plugin.keywords).toEqual(expect.arrayContaining(['autonomous', 'pipeline', 'agents']))
    expect(plugin.keywords).toContain('minimum-diff')

    expect(codex).toMatchObject({ name: plugin.name, version: pkg.version, skills: './skills/' })
    expect(codex.repository).toBe(plugin.repository)
    expect(codex.keywords).toEqual(expect.arrayContaining(['proof-contract', 'minimum-diff']))

    expect(gemini).toMatchObject({ name: plugin.name, version: pkg.version, contextFileName: 'AGENTS.md' })

    expect(marketplace.name).toBe(plugin.name)
    expect(marketplace.owner.name).toBe(plugin.author.name)
    expect(marketplace.plugins).toHaveLength(1)
    expect(marketplace.plugins[0]).toMatchObject({ name: plugin.name, source: './' })
  })

  it('validates skill frontmatter and directory names', () => {
    const skillsRoot = join(repoRoot, 'skills')
    const skillFiles = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(skillsRoot, entry.name, 'SKILL.md'))

    expect(skillFiles.length).toBeGreaterThanOrEqual(7)
    const names = skillFiles.map((path) => parseFrontmatter(path).name)
    expect(new Set(names).size).toBe(names.length)

    for (const path of skillFiles) {
      const frontmatter = parseFrontmatter(path)
      expect(frontmatter.name).toBe(basename(dirname(path)))
      expect(frontmatter.description.length).toBeGreaterThan(40)
      expect(frontmatter.argument_hint).toBeTruthy()
      expect(readFileSync(path, 'utf8')).toMatch(/^#\s+\S/m)
    }
  })

  it('validates agent frontmatter and unique names', () => {
    const agentFiles = listFiles(join(repoRoot, 'agents'), (path) => path.endsWith('.md'))
    const names = agentFiles.map((path) => parseFrontmatter(path).name)

    expect(agentFiles.length).toBe(4)
    expect(new Set(names).size).toBe(names.length)

    for (const path of agentFiles) {
      const frontmatter = parseFrontmatter(path)
      expect(frontmatter.name).toBe(basename(path, '.md'))
      expect(frontmatter.description.length).toBeGreaterThan(40)
      expect(frontmatter.tools).toBeTruthy()
      expect(frontmatter.tools).not.toContain('undefined')
      if (frontmatter.isolation) expect(frontmatter.isolation).toBe('worktree')
    }
  })

  it('resolves all bundled plugin-root references in skills, agents, and knowledge', () => {
    const unresolved: string[] = []

    for (const path of markdownFiles('skills', 'agents', 'knowledge')) {
      const content = readFileSync(path, 'utf8')
      for (const ref of extractRefs(content, '${CLAUDE_PLUGIN_ROOT}/')) {
        if (!resolveRef(repoRoot, ref)) unresolved.push(`${relative(repoRoot, path)} -> ${ref}`)
      }
    }

    expect(unresolved).toEqual([])
  })

  it('installs a vendored .claude engine without overwriting project config', () => {
    const target = mkdtempSync(join(tmpdir(), 'yalla-plugin-install-'))
    mkdirSync(join(target, '.claude'), { recursive: true })
    writeFileSync(join(target, '.claude/YALLA.md'), 'repo: "kept/config"\n')

    execFileSync(join(repoRoot, 'install.sh'), [target], { cwd: repoRoot, stdio: 'pipe' })

    expect(readFileSync(join(target, '.claude/YALLA.md'), 'utf8')).toBe('repo: "kept/config"\n')
    expect(existsSync(join(target, '.claude/skills/yalla/SKILL.md'))).toBe(true)
    expect(existsSync(join(target, '.claude/agents/yalla-lead.md'))).toBe(true)
    expect(existsSync(join(target, '.claude/knowledge/yalla/PROJECT-CHECKS.md'))).toBe(true)
    expect(existsSync(join(target, '.claude/knowledge/product/PRODUCT-INTENT-FRAMEWORK.md'))).toBe(true)

    const installedMarkdown = listFiles(join(target, '.claude'), (path) => path.endsWith('.md'))
    const unresolved: string[] = []
    for (const path of installedMarkdown) {
      const content = readFileSync(path, 'utf8')
      expect(content).not.toContain('${CLAUDE_PLUGIN_ROOT}')
      for (const ref of extractRefs(content, '.claude/')) {
        if (!resolveRef(target, `.claude/${ref}`)) unresolved.push(`${relative(target, path)} -> .claude/${ref}`)
      }
    }

    expect(unresolved).toEqual([])
    expect(listFiles(join(target, '.claude'), (path) => path.endsWith('.md.bak'))).toEqual([])
  })

  it('installs cross-agent adapters when host directories exist', () => {
    const target = mkdtempSync(join(tmpdir(), 'yalla-adapters-install-'))
    mkdirSync(join(target, '.opencode'), { recursive: true })
    mkdirSync(join(target, '.cursor'), { recursive: true })
    mkdirSync(join(target, '.windsurf'), { recursive: true })
    mkdirSync(join(target, '.clinerules'), { recursive: true })
    mkdirSync(join(target, '.kiro'), { recursive: true })

    execFileSync(join(repoRoot, 'install.sh'), [target], { cwd: repoRoot, stdio: 'pipe' })

    expect(existsSync(join(target, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(target, '.opencode/plugins/yalla.mjs'))).toBe(true)
    expect(existsSync(join(target, 'hooks/yalla-config.cjs'))).toBe(true)
    expect(existsSync(join(target, 'hooks/yalla-instructions.cjs'))).toBe(true)
    expect(existsSync(join(target, '.cursor/rules/yalla.mdc'))).toBe(true)
    expect(existsSync(join(target, '.windsurf/rules/yalla.md'))).toBe(true)
    expect(existsSync(join(target, '.clinerules/yalla.md'))).toBe(true)
    expect(existsSync(join(target, '.kiro/steering/yalla.md'))).toBe(true)
    expect(existsSync(join(target, '.github/copilot-instructions.md'))).toBe(true)
  })

  it('keeps compact rule adapters aligned with AGENTS.md', () => {
    const output = execFileSync('npm', ['run', 'rules:check'], { cwd: repoRoot, encoding: 'utf8' })

    expect(output).toContain('Rule copies match AGENTS.md')
  })

  it('seeds a project config when vendored into a new repo', () => {
    const target = mkdtempSync(join(tmpdir(), 'yalla-plugin-seed-'))

    execFileSync(join(repoRoot, 'install.sh'), [target], { cwd: repoRoot, stdio: 'pipe' })

    const config = readFileSync(join(target, '.claude/YALLA.md'), 'utf8')
    expect(config).toContain('base_branch:')
    expect(config).toContain('tracking_mode:')
    expect(config).toContain('commands:')
  })

  it('does not track runtime artifacts in the plugin package source', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    const forbidden = tracked.filter((path) =>
      path.startsWith('.pipeline/') ||
      path === '.pipeline-state.json' ||
      path.startsWith('plans/') ||
      path.startsWith('node_modules/') ||
      path.includes('/.claude/worktrees/') ||
      path.endsWith('.bak')
    )

    expect(forbidden).toEqual([])
  })
})
