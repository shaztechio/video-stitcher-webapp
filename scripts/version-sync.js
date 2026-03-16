#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const { version } = rootPkg

for (const pkg of ['client', 'server']) {
  const pkgPath = resolve(root, pkg, 'package.json')
  const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkgJson.version = version
  writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n')
  console.log(`Updated ${pkg}/package.json to ${version}`)
}
