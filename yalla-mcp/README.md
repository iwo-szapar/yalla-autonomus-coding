# yalla-mcp

Dependency-free MCP prompt/tool wrapper for Yalla's compact instructions.

This is for hosts that cannot inject hooks or skills every turn but can request MCP prompts or tools. It is not a replacement for the Claude/Codex/OpenCode adapters.

## Exposed Surface

- Prompt `yalla`, optional `mode`: `lean`, `standard`, or `strict`.
- Tool `yalla_instructions`, same modes, returning text plus structured `{ mode, instructions }`.

Mode resolution reuses `hooks/yalla-config.cjs`, so `YALLA_DEFAULT_MODE` and `~/.config/yalla/config.json` stay consistent with other adapters.

## Run

```bash
cd yalla-mcp
npm test
node index.js
```

Client entry example:

```json
{ "mcpServers": { "yalla": { "command": "node", "args": ["yalla-mcp/index.js"] } } }
```
