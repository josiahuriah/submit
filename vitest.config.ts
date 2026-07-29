import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
