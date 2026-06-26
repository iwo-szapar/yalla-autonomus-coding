import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('yalla-mcp', () => {
  it('serves instructions through the MCP tool surface', () => {
    const input = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'yalla_instructions', arguments: { mode: 'lean' } } })}\n`
    const result = spawnSync('node', ['yalla-mcp/index.js'], { input, encoding: 'utf8' })

    expect(result.status).toBe(0)
    const response = JSON.parse(result.stdout.trim())
    expect(response.result.structuredContent.mode).toBe('lean')
    expect(response.result.structuredContent.instructions).toContain('YALLA MODE ACTIVE - lean')
    expect(response.result.structuredContent.instructions).toContain('minimum-diff ladder')
  })
})
