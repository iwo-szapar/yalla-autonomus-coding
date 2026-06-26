#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import { buildInstructions, MODES, resolveMode } from './instructions.js'

function result(id, value) {
  return { jsonrpc: '2.0', id, result: value }
}

function error(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function handle(message) {
  const { id, method, params = {} } = message

  if (method === 'initialize') {
    return result(id, {
      protocolVersion: '2024-11-05',
      capabilities: { prompts: {}, tools: {} },
      serverInfo: { name: 'yalla-mcp', version: '1.3.0' },
    })
  }

  if (method === 'prompts/list') {
    return result(id, {
      prompts: [{
        name: 'yalla',
        description: 'Return Yalla proof-first minimum-diff instructions.',
        arguments: [{ name: 'mode', description: MODES.join('|'), required: false }],
      }],
    })
  }

  if (method === 'prompts/get') {
    if (params.name !== 'yalla') return error(id, -32602, 'Unknown prompt')
    const mode = resolveMode(params.arguments?.mode)
    return result(id, {
      description: `Yalla instructions (${mode})`,
      messages: [{ role: 'user', content: { type: 'text', text: buildInstructions(mode) } }],
    })
  }

  if (method === 'tools/list') {
    return result(id, {
      tools: [{
        name: 'yalla_instructions',
        description: 'Return Yalla instructions for a requested ceremony mode.',
        inputSchema: {
          type: 'object',
          properties: { mode: { type: 'string', enum: MODES } },
          additionalProperties: false,
        },
      }],
    })
  }

  if (method === 'tools/call') {
    if (params.name !== 'yalla_instructions') return error(id, -32602, 'Unknown tool')
    const mode = resolveMode(params.arguments?.mode)
    const instructions = buildInstructions(mode)
    return result(id, {
      content: [{ type: 'text', text: instructions }],
      structuredContent: { mode, instructions },
    })
  }

  if (method === 'notifications/initialized') return null
  return error(id, -32601, 'Method not found')
}

const rl = createInterface({ input: stdin, crlfDelay: Infinity })

rl.on('line', (line) => {
  if (!line.trim()) return
  try {
    const response = handle(JSON.parse(line))
    if (response) stdout.write(`${JSON.stringify(response)}\n`)
  } catch (caught) {
    stdout.write(`${JSON.stringify(error(null, -32700, caught instanceof Error ? caught.message : 'Parse error'))}\n`)
  }
})
