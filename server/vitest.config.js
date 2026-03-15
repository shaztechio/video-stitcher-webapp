import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      all: true,
      include: [
        'middleware/**/*.js',
        'routes/**/*.js',
        'services/**/*.js',
        'utils/**/*.js'
      ],
      exclude: [
        'node_modules/**',
        'coverage/**',
        '**/*.config.js',
        '**/*.config.cjs',
        '__tests__/**'
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100
      }
    }
  }
})
