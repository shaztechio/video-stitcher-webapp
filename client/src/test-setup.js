/*
 * Copyright 2026 shaztechio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import '@testing-library/jest-dom'

// Override .env.local values before any test modules are imported.
// .env.local has VITE_DISABLE_AUTH=true and VITE_API_URL=http://localhost:3000,
// which would break auth-required tests.  These values are reset here so that
// the auth code paths are exercised by default, while env-specific tests use
// vi.stubEnv + vi.resetModules to test alternative branches.
import.meta.env.VITE_DISABLE_AUTH = ''
import.meta.env.VITE_GOOGLE_CLIENT_ID = 'test-client-id-123'
import.meta.env.VITE_API_URL = 'http://localhost:3000'
