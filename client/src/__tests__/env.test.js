import { describe, it, expect, vi, afterEach } from 'vitest'

// All tests dynamically import '../env' after stubbing env vars so that the
// module-level constants are re-evaluated with the desired values.

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('env', () => {
  it('API_URL uses VITE_API_URL when it is defined (non-fallback branch)', async () => {
    vi.stubEnv('VITE_API_URL', 'http://custom-api.example.com')
    vi.resetModules()
    const { API_URL } = await import('../env')
    expect(API_URL).toBe('http://custom-api.example.com')
  })

  it('API_URL falls back to localhost:3000 when VITE_API_URL is empty (fallback branch)', async () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.resetModules()
    const { API_URL } = await import('../env')
    expect(API_URL).toBe('http://localhost:3000')
  })

  it('GOOGLE_CLIENT_ID returns the env value', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'my-client-id')
    vi.resetModules()
    const { GOOGLE_CLIENT_ID } = await import('../env')
    expect(GOOGLE_CLIENT_ID).toBe('my-client-id')
  })

  it('DISABLE_AUTH is true when VITE_DISABLE_AUTH is "true"', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    vi.resetModules()
    const { DISABLE_AUTH } = await import('../env')
    expect(DISABLE_AUTH).toBe(true)
  })

  it('DISABLE_AUTH is false when VITE_DISABLE_AUTH is not "true"', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', '')
    vi.resetModules()
    const { DISABLE_AUTH } = await import('../env')
    expect(DISABLE_AUTH).toBe(false)
  })
})
