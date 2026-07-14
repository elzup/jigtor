import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 20000,
  },
})
