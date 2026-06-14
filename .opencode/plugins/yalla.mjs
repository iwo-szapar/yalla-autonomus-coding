// Yalla OpenCode plugin.
// Injects compact Yalla proof/minimum-diff rules each turn and persists `/yalla lean|standard|strict|off` mode switches.

import { createRequire } from 'module'
import fs from 'fs'
import os from 'os'
import path from 'path'

const require = createRequire(import.meta.url)
const { getYallaInstructions } = require('../../hooks/yalla-instructions.cjs')
const { getDefaultMode, normalizeMode } = require('../../hooks/yalla-config.cjs')

const statePath = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', '.yalla-mode')

function readMode() {
  try {
    return normalizeMode(fs.readFileSync(statePath, 'utf8').trim()) || getDefaultMode()
  } catch (_) {
    return getDefaultMode()
  }
}

function writeMode(mode) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, mode)
}

export default async ({ client } = {}) => ({
  'experimental.chat.system.transform': async (_input, output) => {
    const instructions = getYallaInstructions(readMode())
    if (instructions) output.system.push(instructions)
  },
  'command.execute.before': async input => {
    if (!input || input.command !== 'yalla') return
    const firstArg = String(input.arguments || '').trim().split(/\s+/)[0]
    const mode = normalizeMode(firstArg)
    if (!mode) return
    writeMode(mode)
    try {
      client && client.app && client.app.log({ body: { service: 'yalla', level: 'info', message: `mode ${mode}` } })
    } catch (_) {}
  },
})
