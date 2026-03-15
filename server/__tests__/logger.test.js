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
