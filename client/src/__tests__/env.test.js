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
