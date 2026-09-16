import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ResponseShapeError } from './api'
import {
  capacityKeys,
  capacityQueryOptions,
  isTransient,
  updateWeeklyHoursOptions,
} from './queries'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isTransient', () => {
  it.each([
    ['a network failure', new TypeError('Failed to fetch'), true],
    ['a 500', new ApiError('boom', 500), true],
    ['a 400', new ApiError('bad range', 400), false],
    ['a 404', new ApiError('person not found', 404), false],
  ])('retries %s: %s', (_, error, want) => {
    expect(isTransient(error)).toBe(want)
  })

  it('does not retry a response that fails its schema', async () => {
    const { z } = await import('zod')
    const parsed = z.object({ a: z.number() }).safeParse({})
    if (parsed.success) throw new Error('expected a parse failure')
    expect(isTransient(new ResponseShapeError('/api/capacity', parsed.error))).toBe(false)
  })
})

describe('capacityQueryOptions', () => {
  it('keys by the whole weeks the API will return, so equivalent ranges share a cache entry', () => {
    expect(capacityQueryOptions('2025-12-31', '2026-01-14').queryKey).toEqual(
      capacityKeys.range('2025-12-29', '2026-01-18'),
    )
    expect(capacityQueryOptions('2025-12-29', '2026-01-18').queryKey).toEqual(
      capacityQueryOptions('2025-12-31', '2026-01-14').queryKey,
    )
  })
})

describe('updateWeeklyHoursOptions', () => {
  const capacity = (from: string, to: string) => ({ from, to, weeks: [], people: [] })

  it('invalidates every cached range and stays pending until the visible one has refetched', async () => {
    let finishRefetch: (response: Response) => void = () => {}
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/people/')) {
        return Response.json({ id: 4, name: 'Dee Okafor', weekly_hours: 45 })
      }
      return new Promise<Response>((resolve) => {
        finishRefetch = resolve
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const visible = capacityQueryOptions('2025-12-29', '2026-01-18')
    const cachedElsewhere = capacityQueryOptions('2026-01-05', '2026-01-25')
    client.setQueryData(visible.queryKey, capacity('2025-12-29', '2026-01-18'))
    client.setQueryData(cachedElsewhere.queryKey, capacity('2026-01-05', '2026-01-25'))

    // Only the visible range has an observer (a mounted grid).
    const unsubscribe = new QueryObserver(client, { ...visible, staleTime: Infinity }).subscribe(
      () => {},
    )

    let settled = false
    const save = new MutationObserver(client, updateWeeklyHoursOptions(client))
      .mutate({ id: 4, weeklyHours: 45 })
      .then(() => {
        settled = true
      })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)) // PATCH, then the refetch
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('from=2025-12-29')
    expect(settled).toBe(false) // "Saving…" must not clear while the grid still shows old numbers

    finishRefetch(Response.json(capacity('2025-12-29', '2026-01-18')))
    await save
    expect(settled).toBe(true)

    expect(client.getQueryState(visible.queryKey)?.isInvalidated).toBe(false) // refetched
    expect(client.getQueryState(cachedElsewhere.queryKey)?.isInvalidated).toBe(true) // refetches on next visit
    expect(fetchMock).toHaveBeenCalledTimes(2) // the unseen range was not fetched eagerly

    unsubscribe()
    client.clear()
  })
})
