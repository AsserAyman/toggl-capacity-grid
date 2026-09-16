import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The containers run in UTC, which would hide every timezone bug the date
    // helpers exist to prevent. Run behind UTC, where local midnight is still the
    // previous day in UTC terms, and across a DST change (2026-03-08).
    env: { TZ: 'America/Los_Angeles' },
  },
})
