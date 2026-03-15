import neostandard, { plugins as neoPlugins } from 'neostandard'
import globals from 'globals'

export default [
  { ignores: ['coverage'] },

  ...neostandard({ noJsx: true, globals: globals.node }),

  {
    plugins: { '@stylistic': neoPlugins['@stylistic'] },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', args: 'none' }],
      '@stylistic/curly-newline': ['error', { minElements: 1 }],
    },
  },

  {
    files: ['__tests__/**/*.js', 'vitest.config.js'],
    rules: {
      'no-unused-vars': 'off',
    },
  },
]
