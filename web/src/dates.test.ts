import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDays, daysBetween, formatShort, isIsoDate, mondayOf, parseDate, today } from './dates'

it('runs in a non-UTC timezone, or these tests prove nothing', () => {
  expect(new Date('2026-01-05T00:00:00Z').getTimezoneOffset()).not.toBe(0)
})

describe('parseDate', () => {
  it('is UTC midnight, not local midnight', () => {
    expect(parseDate('2026-01-05').getTime()).toBe(Date.UTC(2026, 0, 5))
  })

  it.each(['2026-1-5', '05/01/2026', '', '2026-01-05T00:00:00Z'])('rejects %j', (input) => {
    expect(() => parseDate(input)).toThrow('expected YYYY-MM-DD')
  })
})

describe('isIsoDate', () => {
  it.each(['2026-02-28', '2024-02-29', '2025-12-31'])('accepts %s', (input) => {
    expect(isIsoDate(input)).toBe(true)
  })

  it.each(['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-10', '2026-1-05', 'yesterday', ''])(
    'rejects %j',
    (input) => {
      expect(isIsoDate(input)).toBe(false)
    },
  )
})

describe('addDays', () => {
  it.each([
    ['2025-12-29', 7, '2026-01-05'], // year boundary
    ['2026-01-05', -7, '2025-12-29'],
    ['2026-03-07', 1, '2026-03-08'], // US DST starts
    ['2026-03-08', 1, '2026-03-09'],
    ['2026-02-28', 1, '2026-03-01'],
  ])('%s %+d → %s', (from, days, want) => {
    expect(addDays(from, days)).toBe(want)
  })
})

describe('mondayOf', () => {
  it.each([
    ['2026-01-05', '2026-01-05'], // Monday is its own week start
    ['2026-01-04', '2025-12-29'], // Sunday belongs to the week before
    ['2026-01-01', '2025-12-29'], // Thursday, across the year boundary
    ['2026-03-08', '2026-03-02'], // DST day
  ])('%s → %s', (input, want) => {
    expect(mondayOf(input)).toBe(want)
  })
})

describe('daysBetween', () => {
  it('counts calendar days, even across a DST change (a 23-hour day)', () => {
    expect(daysBetween('2026-03-02', '2026-03-13')).toBe(11)
    expect(daysBetween('2026-01-05', '2026-01-23')).toBe(18)
  })
})

describe('today', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("is the viewer's local date, not the UTC date", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-05T03:00:00Z')) // Jan 4, 19:00 in Los Angeles
    expect(today()).toBe('2026-01-04')
  })
})

describe('formatShort', () => {
  it('formats the calendar date, not the local-time instant', () => {
    expect(formatShort('2026-01-05')).toBe('Jan 5')
  })
})
