#!/usr/bin/env node
// Copyright 2026 shaztechio
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Uploads the GCP Service Account key JSON as the GCP_SA_KEY GitHub secret.
 *
 * Usage:
 *   node scripts/set-gcp-secret.js path/to/service-account-key.json
 */

import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'

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

const keyPath = process.argv[2]
if (!keyPath) {
  console.error('Usage: node scripts/set-gcp-secret.js path/to/service-account-key.json')
  process.exit(1)
}

checkGh()

const absPath = resolve(keyPath)
let keyContent
try {
  keyContent = readFileSync(absPath, 'utf8')
  JSON.parse(keyContent) // validate it's valid JSON
} catch (err) {
  console.error(`Error reading key file: ${err.message}`)
  process.exit(1)
}

console.log('Setting GCP_SA_KEY secret...')
run(`gh secret set GCP_SA_KEY --body ${JSON.stringify(keyContent)}`)
console.log('Done. GCP_SA_KEY has been set as a GitHub Actions secret.')
