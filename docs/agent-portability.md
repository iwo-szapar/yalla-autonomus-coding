# Agent Portability

Yalla is distributed as a portable agent ruleset plus host-specific adapters. The single source of truth for compact always-on behavior is `AGENTS.md`. Runtime hosts that can execute code should load `hooks/yalla-instructions.cjs`, which reads `AGENTS.md` and prepends the active ceremony mode.

## Supported Adapters

| Host | Files | Notes |
|------|-------|-------|
| Claude Code | `.claude-plugin/`, `skills/`, `agents/`, `knowledge/` | Full plugin install with Yalla skills, agents, and knowledge base. |
| Codex | `.codex-plugin/plugin.json`, `skills/`, `AGENTS.md` | Plugin manifest points at the shared skill directory; compact behavior lives in `AGENTS.md`. |
| OpenCode | `.opencode/plugins/yalla.mjs`, `hooks/`, `skills/` | Server plugin injects `getYallaInstructions(mode)` every turn and persists `/yalla lean|standard|strict|off`. Copy the plugin and `hooks/yalla-*.cjs` together. |
| Gemini CLI | `gemini-extension.json`, `AGENTS.md`, `skills/` | Extension manifest points `contextFileName` at `AGENTS.md`; skills remain reusable. |
| Cursor | `.cursor/rules/yalla.mdc` | Always-on project rule copied from `AGENTS.md` with Cursor frontmatter. |
| Windsurf | `.windsurf/rules/yalla.md` | Project rule copied from `AGENTS.md`. |
| Cline | `.clinerules/yalla.md` | Project rule copied from `AGENTS.md`. |
| GitHub Copilot | `.github/copilot-instructions.md` | Repository instruction file copied from `AGENTS.md`. |
| Kiro | `.kiro/steering/yalla.md` | Steering rule copied from `AGENTS.md` with Kiro frontmatter. |
| Generic agents | `AGENTS.md` or `skills/*/SKILL.md` | Copy compact instructions or load skills directly. |

## Single Source Rule

- `AGENTS.md` is the compact, always-on source for hosts without skill/hook support.
- `hooks/yalla-instructions.cjs` reads `AGENTS.md` at runtime and adds ceremony-mode guidance.
- Host-specific rule files must stay byte-aligned with `AGENTS.md` after stripping frontmatter.
- `scripts/check-rule-copies.cjs` enforces drift checks.

## Ceremony Modes

- `lean`: minimum ceremony, still proof-first. Use for tiny hotfixes and small diffs.
- `standard`: default adaptive pipeline.
- `strict`: high-risk or broad work. Requires fuller evidence and review artifacts.
- `off`: no injected compact rules for hosts with runtime mode support.

Ceremony mode changes evidence volume, not honesty. Only `PROVEN` is success in every mode.
