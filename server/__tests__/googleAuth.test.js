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

// ---------------------------------------------------------------------------
// Strategy: googleAuth.js calls `new OAuth2Client()` at module load time and
// reads ALLOWED_USERS at module load time. To control both per-test we:
//  1. Use vi.mock to replace OAuth2Client with a proper constructor that
//     delegates to a mutable mock instance.
//  2. Call vi.resetModules() + re-import in each test to trigger re-evaluation
//     of ALLOWED_USERS from process.env.
// ---------------------------------------------------------------------------

// Shared mutable mock instance — the OAuth2Client constructor sets this up
const mockVerifyIdToken = vi.fn()

vi.mock('google-auth-library', () => {
  // Must be a regular function (not arrow) so `new` works
  function OAuth2Client () {
    this.verifyIdToken = mockVerifyIdToken
  }
  return { OAuth2Client }
})

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

async function loadMiddleware () {
  // Re-import so ALLOWED_USERS is re-evaluated from current process.env
  const mod = await import('../middleware/googleAuth.js')
  return mod.default
}

function makeReqRes () {
  const req = { headers: {}, user: null }
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  }
  const next = vi.fn()
  return { req, res, next }
}

describe('googleAuth middleware', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('bypasses auth when DISABLE_AUTH=true and calls next', async () => {
    vi.stubEnv('DISABLE_AUTH', 'true')
    vi.stubEnv('ALLOWED_USERS', '')
    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()

    await verifyGoogleToken(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.user).toEqual({ email: 'local-user@local-stitcher', name: 'Local User' })
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 401 when no Authorization header', async () => {
    vi.stubEnv('DISABLE_AUTH', 'false')
    vi.stubEnv('ALLOWED_USERS', '')
    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()

    await verifyGoogleToken(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    vi.stubEnv('DISABLE_AUTH', 'false')
    vi.stubEnv('ALLOWED_USERS', '')
    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Basic abc123'

    await verifyGoogleToken(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 when token verification throws', async () => {
    vi.stubEnv('DISABLE_AUTH', 'false')
    vi.stubEnv('ALLOWED_USERS', '')
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Token expired'))

    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer invalid-token'

    await verifyGoogleToken(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 when payload has no email (null email)', async () => {
    vi.stubEnv('DISABLE_AUTH', 'false')
    vi.stubEnv('ALLOWED_USERS', '')
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ email: null }) })

    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer valid-token'

    await verifyGoogleToken(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token: no email claim' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 when getPayload returns null (no email claim via optional chain)', async () => {
    vi.stubEnv('DISABLE_AUTH', 'false')
    vi.stubEnv('ALLOWED_USERS', '')
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => null })

    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer valid-token'

    await verifyGoogleToken(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token: no email claim' })
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next when token is valid and no allowlist configured', async () => {
    vi.stubEnv('DISABLE_AUTH', 'false')
    vi.stubEnv('ALLOWED_USERS', '')
    const payload = { email: 'user@example.com', name: 'Test User' }
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => payload })

    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer valid-token'

    await verifyGoogleToken(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.user).toEqual(payload)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('calls next when email is in the comma-separated allowlist', async () => {
    vi.stubEnv('DISABLE_AUTH', 'false')
    vi.stubEnv('ALLOWED_USERS', 'alice@example.com,bob@example.com')
    const payload = { email: 'alice@example.com' }
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => payload })

    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer valid-token'

    await verifyGoogleToken(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.user).toEqual(payload)
  })

  it('calls next when email is in the semicolon-separated allowlist', async () => {
    vi.stubEnv('DISABLE_AUTH', 'false')
    vi.stubEnv('ALLOWED_USERS', 'alice@example.com;bob@example.com')
    const payload = { email: 'bob@example.com' }
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => payload })

    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer valid-token'

    await verifyGoogleToken(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.user).toEqual(payload)
  })

  it('returns 403 when email is not in allowlist', async () => {
    vi.stubEnv('DISABLE_AUTH', 'false')
    vi.stubEnv('ALLOWED_USERS', 'alice@example.com;bob@example.com')
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ email: 'eve@example.com' }) })

    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer valid-token'

    await verifyGoogleToken(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Access denied: your email is not on the allowlist.' })
    expect(next).not.toHaveBeenCalled()
  })

  it('does allowlist check case-insensitively', async () => {
    vi.stubEnv('DISABLE_AUTH', 'false')
    vi.stubEnv('ALLOWED_USERS', 'Alice@Example.com')
    const payload = { email: 'ALICE@EXAMPLE.COM' }
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => payload })

    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer valid-token'

    await verifyGoogleToken(req, res, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('uses GOOGLE_CLIENT_ID as audience when configured', async () => {
    vi.stubEnv('DISABLE_AUTH', 'false')
    vi.stubEnv('ALLOWED_USERS', '')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'my-client-id.apps.googleusercontent.com')
    const payload = { email: 'user@example.com' }
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => payload })

    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer valid-token'

    await verifyGoogleToken(req, res, next)

    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'valid-token',
      audience: 'my-client-id.apps.googleusercontent.com'
    })
    expect(next).toHaveBeenCalledOnce()
  })

  it('passes undefined as audience when GOOGLE_CLIENT_ID is not set', async () => {
    vi.stubEnv('DISABLE_AUTH', 'false')
    vi.stubEnv('ALLOWED_USERS', '')
    // Ensure GOOGLE_CLIENT_ID is not set
    delete process.env.GOOGLE_CLIENT_ID
    const payload = { email: 'user@example.com' }
    mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => payload })

    const verifyGoogleToken = await loadMiddleware()
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer valid-token'

    await verifyGoogleToken(req, res, next)

    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'valid-token',
      audience: undefined
    })
    expect(next).toHaveBeenCalledOnce()
  })
})
