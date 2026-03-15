#!/usr/bin/env node
/**
 * Reads gcp_config.json and sets all required GitHub Actions Variables.
 *
 * Usage:
 *   node scripts/set-github-vars.js
 */

import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', ...opts }).trim()
}

function checkGh() {
  try {
    run('gh --version')
  } catch {
    console.error('Error: gh CLI is not installed.')
    console.error('  macOS:  brew install gh')
    console.error('  Other:  https://cli.github.com')
    process.exit(1)
  }

  try {
    run('gh auth status')
  } catch {
    console.error('Error: gh CLI is not authenticated.')
    console.error('  Run: gh auth login')
    process.exit(1)
  }
}

checkGh()

const configPath = resolve(__dirname, '..', 'gcp_config.json')
let config
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'))
} catch (err) {
  console.error(`Error reading gcp_config.json: ${err.message}`)
  console.error('Make sure gcp_config.json exists in the repo root.')
  process.exit(1)
}

const varMap = [
  ['GCP_PROJECT_ID',    config['projectId']],
  ['GCP_REGION',        config['region']],
  ['GCP_SERVER_SERVICE', config['server-serviceName']],
  ['GCP_CLIENT_SERVICE', config['client-serviceName']],
  ['ALLOWED_USERS',     config['allowedUsers']],
  ['GOOGLE_CLIENT_ID',  config['clientId']],
]

for (const [name, value] of varMap) {
  if (!value) {
    console.warn(`Warning: gcp_config.json is missing a value for "${name}" — skipping.`)
    continue
  }
  console.log(`Setting variable ${name}...`)
  run(`gh variable set ${name} --body ${JSON.stringify(String(value))}`)
}

console.log('Done. All GitHub Actions variables have been set.')
