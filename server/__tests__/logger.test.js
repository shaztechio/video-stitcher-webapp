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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('logger', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('creates a pino logger with default info level', async () => {
    vi.stubEnv('LOG_LEVEL', '')
    const mod = await import('../utils/logger.js')
    const logger = mod.default
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
  })

  it('creates a pino logger with LOG_LEVEL env var', async () => {
    vi.stubEnv('LOG_LEVEL', 'debug')
    const mod = await import('../utils/logger.js')
    const logger = mod.default
    expect(logger).toBeDefined()
    expect(logger.level).toBe('debug')
  })

  it('creates a pino logger with default info level when LOG_LEVEL not set', async () => {
    vi.unstubAllEnvs()
    delete process.env.LOG_LEVEL
    const mod = await import('../utils/logger.js')
    const logger = mod.default
    expect(logger).toBeDefined()
    expect(logger.level).toBe('info')
  })
})
