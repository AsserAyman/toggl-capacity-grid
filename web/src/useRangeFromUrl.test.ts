import { describe, expect, it } from 'vitest'
import { parseRange } from './useRangeFromUrl'

describe('parseRange', () => {
  it('reads from and to', () => {
    expect(parseRange('?from=2026-03-02&to=2026-03-20')).toEqual({ from: '2026-03-02', to: '2026-03-20' })
  })

  it('ignores unrelated params', () => {
    expect(parseRange('?team=design&from=2026-03-02&to=2026-03-20')).toEqual({
      from: '2026-03-02',
      to: '2026-03-20',
    })
  })

  it('accepts a single-day range', () => {
    expect(parseRange('?from=2026-03-02&to=2026-03-02')).toEqual({ from: '2026-03-02', to: '2026-03-02' })
  })

  it.each([
    ['no params', ''],
    ['only from', '?from=2026-03-02'],
    ['impossible date', '?from=2026-02-31&to=2026-03-06'],
    ['malformed date', '?from=yesterday&to=2026-03-06'],
    ['to before from', '?from=2026-03-20&to=2026-03-02'],
  ])('returns null for %s', (_, search) => {
    expect(parseRange(search)).toBeNull()
  })
})
