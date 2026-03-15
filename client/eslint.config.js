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
