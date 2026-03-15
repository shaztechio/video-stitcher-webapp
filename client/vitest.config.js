import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      all: true,
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/main.jsx',
        'src/App.css',
        'src/index.css',
        'src/components/DropZone.css',
        'src/__tests__/**',
        'src/test-setup.js',
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
})
