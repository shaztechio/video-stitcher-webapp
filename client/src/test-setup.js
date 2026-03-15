import '@testing-library/jest-dom'

// Override .env.local values before any test modules are imported.
// .env.local has VITE_DISABLE_AUTH=true and VITE_API_URL=http://localhost:3000,
// which would break auth-required tests.  These values are reset here so that
// the auth code paths are exercised by default, while env-specific tests use
// vi.stubEnv + vi.resetModules to test alternative branches.
import.meta.env.VITE_DISABLE_AUTH = ''
import.meta.env.VITE_GOOGLE_CLIENT_ID = 'test-client-id-123'
import.meta.env.VITE_API_URL = 'http://localhost:3000'
