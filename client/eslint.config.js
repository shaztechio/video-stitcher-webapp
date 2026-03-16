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

import neostandard, { plugins as neoPlugins } from 'neostandard'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default [
  { ignores: ['dist', 'coverage'] },

  ...neostandard({ globals: globals.browser }),

  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,

  {
    plugins: { '@stylistic': neoPlugins['@stylistic'] },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', args: 'none' }],
      '@stylistic/curly-newline': ['error', { minElements: 1 }],
    },
  },

  {
    files: ['**/*.test.{js,jsx}', 'src/test-setup.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
]
