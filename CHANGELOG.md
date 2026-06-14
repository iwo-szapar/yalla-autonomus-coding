# Changelog

## Unreleased

- Add a first-class minimum-diff gate (`knowledge/yalla/MINIMUM-DIFF.md`) and wire it into `/yalla` classification, plan templates, and PR summaries.
- Add `/yalla-simplify` and `/yalla-simplify-audit` for deletion-only diff and repo bloat reviews.
- Add cross-agent adapters for OpenCode, Codex, Gemini CLI, Cursor, Windsurf, Cline, Copilot, and Kiro, all aligned to `AGENTS.md` via `npm run rules:check`.
- Add `npm run eval:yalla:minimum-diff` and `npm run yalla:benchmark` fixture scaffolding.
- Add `npm run yalla:run` operator controls: `doctor`, `event`, `checkpoint`, `status`, `report`, `resume`, `rewind`, and `export`.
- Add structured run timeline artifacts (`.pipeline/events.jsonl`) and local checkpoints (`.pipeline/checkpoints/*`, `.pipeline/latest-checkpoint.json`).
- Add local HTML run reports with pipeline graph, status JSON, recent events, artifact counts, and timing telemetry.
- Add portable run export bundles under `.pipeline/export-*`.
- Add optional `models:` phase-routing hints to `YALLA.md` and validate them during onboarding/doctor checks.
- Accept `doc-alignment-check` as a canonical onboarding risk gate so the seeded example config passes first-run validation.
- Add long-running control artifacts and commands: goal contracts, verifier registry, evaluator results, loop-state decisions, session mining, visual evidence slots, and budget telemetry.

## 1.2.0

- Add an optional, config-gated **memory** subsystem: a Phase 0b pre-flight recall and a Phase 5 compound memory-save step in `/yalla`, activated only by a `memory:` block in `.claude/YALLA.md` (off by default; independent of `tracking_mode`).
- Add `knowledge/yalla/MEMORY-PROTOCOL.md` — the directive test and recall/save protocol (15-file knowledge base).
- Add optional `memory_knowledge` / `memory_decisions` schema to `knowledge/yalla/SQL-TEMPLATES.md`.
- Add `memory-routing-check` to `knowledge/yalla/REVIEW-CHECKS.md` (dormant unless a memory store is configured).
- Document the `memory:` config block in `YALLA.example.md`.

## 1.1.0

- Add `/onboard` guided setup skill.
- Add `npm run yalla:onboard -- init|dashboard` for one-command readiness checks.
- Generate `.pipeline/yalla-onboarding-dashboard.html` with required-before-first-run and required-before-autopilot sections.
- Add config-backed queue dry-run and onboarding root inference fixes.
