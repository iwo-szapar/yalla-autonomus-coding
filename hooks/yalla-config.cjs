const fs = require('fs')
const os = require('os')
const path = require('path')

const DEFAULT_MODE = 'standard'
const VALID_MODES = ['off', 'lean', 'standard', 'strict']
const MODE_ALIASES = {
  normal: 'off',
  default: 'standard',
}

function normalizeMode(mode) {
  if (typeof mode !== 'string') return null
  const normalized = mode.trim().toLowerCase()
  const aliased = MODE_ALIASES[normalized] || normalized
  return VALID_MODES.includes(aliased) ? aliased : null
}

function isDeactivationCommand(text) {
  const normalized = String(text || '').trim().toLowerCase().replace(/[.!?\s]+$/, '')
  return normalized === 'stop yalla' || normalized === 'normal mode' || normalized === '/yalla off' || normalized === '/yalla normal'
}

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'yalla')
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'yalla')
  }
  return path.join(os.homedir(), '.config', 'yalla')
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json')
}

function getDefaultMode() {
  const envMode = normalizeMode(process.env.YALLA_DEFAULT_MODE)
  if (envMode) return envMode

  try {
    const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'))
    return normalizeMode(config.defaultMode) || DEFAULT_MODE
  } catch (_) {
    return DEFAULT_MODE
  }
}

function writeDefaultMode(mode) {
  const normalized = normalizeMode(mode)
  if (!normalized) return null
  const configPath = getConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify({ defaultMode: normalized }, null, 2), 'utf8')
  return normalized
}

module.exports = {
  DEFAULT_MODE,
  VALID_MODES,
  getConfigDir,
  getConfigPath,
  getDefaultMode,
  isDeactivationCommand,
  normalizeMode,
  writeDefaultMode,
}
