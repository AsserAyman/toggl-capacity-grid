import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ResponseShapeError, fetchCapacity, updateWeeklyHours } from './api'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const capacityBody = (people: unknown[]) => ({
  from: '2025-12-29',
  to: '2026-01-11',
  weeks: ['2025-12-29', '2026-01-05'],
  people,
})

const ana = {
  id: 1,
  name: 'Ana Ferreira',
  weekly_hours: 40,
  weeks: [
    { allocated: 40, capacity: 40 },
    { allocated: 0, capacity: 40 },
  ],
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchCapacity', () => {
  it('attaches each cell to its week', async () => {
    stubFetch(json(capacityBody([ana])))
    const data = await fetchCapacity('2025-12-29', '2026-01-11')
    expect(data.people[0]?.weeks).toEqual([
      { week: '2025-12-29', allocated: 40, capacity: 40 },
      { week: '2026-01-05', allocated: 0, capacity: 40 },
    ])
  })

  it('sends the range as query params', async () => {
    const fetchMock = stubFetch(json(capacityBody([])))
    await fetchCapacity('2025-12-29', '2026-01-11')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/capacity?from=2025-12-29&to=2026-01-11')
  })

  it('rejects a person with a missing week instead of misaligning columns', async () => {
    stubFetch(json(capacityBody([{ ...ana, weeks: ana.weeks.slice(0, 1) }])))
    const result = fetchCapacity('2025-12-29', '2026-01-11')
    await expect(result).rejects.toBeInstanceOf(ResponseShapeError)
    await expect(result).rejects.toThrow('exactly one cell per week')
  })

  it('rejects wrongly typed fields', async () => {
    const weeks = [{ allocated: '40', capacity: 40 }, ana.weeks[1]]
    stubFetch(json(capacityBody([{ ...ana, weeks }])))
    await expect(fetchCapacity('2025-12-29', '2026-01-11')).rejects.toBeInstanceOf(ResponseShapeError)
  })

  it("surfaces the API's error message and status", async () => {
    stubFetch(json({ error: 'range spans more than 53 weeks' }, 400))
    const result = fetchCapacity('2025-01-01', '2026-12-31')
    await expect(result).rejects.toBeInstanceOf(ApiError)
    await expect(result).rejects.toMatchObject({ status: 400, message: 'range spans more than 53 weeks' })
  })

  it('falls back to the status line when the error body is not JSON', async () => {
    stubFetch(new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }))
    await expect(fetchCapacity('2025-12-29', '2026-01-11')).rejects.toMatchObject({
      status: 502,
      message: '502 Bad Gateway',
    })
  })
})

describe('updateWeeklyHours', () => {
  it('PATCHes the new hours as JSON and returns the parsed person', async () => {
    const fetchMock = stubFetch(json({ id: 4, name: 'Dee Okafor', weekly_hours: 37.5 }))
    await expect(updateWeeklyHours(4, 37.5)).resolves.toEqual({
      id: 4,
      name: 'Dee Okafor',
      weekly_hours: 37.5,
    })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/people/4')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({ weekly_hours: 37.5 })
  })
})
