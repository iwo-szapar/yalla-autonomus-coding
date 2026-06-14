const fs = require('fs')
const os = require('os')
const path = require('path')

const DEFAULT_MODE = 'standard'
const VALID_MODES = ['off', 'lean', 'standard', 'strict']

function normalizeMode(mode) {
  if (typeof mode !== 'string') return null
  const normalized = mode.trim().toLowerCase()
  return VALID_MODES.includes(normalized) ? normalized : null
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
  normalizeMode,
  writeDefaultMode,
}
