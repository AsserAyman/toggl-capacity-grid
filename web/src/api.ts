import { z } from 'zod'

// Responses are parsed, not cast: if the API drifts from these schemas the grid
// shows an error instead of rendering undefined as numbers.

const isoDate = z.iso.date()

const weekCapacitySchema = z.object({
  allocated: z.number().nonnegative(),
  capacity: z.number().nonnegative(),
})

const capacityResponseSchema = z
  .object({
    // Whole weeks: from is a Monday, to is a Sunday. May be wider than requested.
    from: isoDate,
    to: isoDate,
    weeks: z.array(isoDate),
    people: z.array(
      z.object({
        id: z.number().int(),
        name: z.string(),
        weekly_hours: z.number().nonnegative(),
        // On the wire, aligned index-for-index with the top-level weeks.
        weeks: z.array(weekCapacitySchema),
      }),
    ),
  })
  .refine((r) => r.people.every((p) => p.weeks.length === r.weeks.length), {
    message: 'every person must have exactly one cell per week',
  })
  // Attach each cell's week once, here, where the alignment has just been
  // checked — so nothing downstream indexes one array by another's position.
  .transform((r) => ({
    ...r,
    people: r.people.map((p) => ({
      ...p,
      weeks: p.weeks.map((cell, i) => ({ week: r.weeks[i]!, ...cell })),
    })),
  }))

const personSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  weekly_hours: z.number().nonnegative(),
})

export type CapacityResponse = z.output<typeof capacityResponseSchema>
export type PersonCapacity = CapacityResponse['people'][number]
export type WeekCapacity = PersonCapacity['weeks'][number]
export type Person = z.output<typeof personSchema>

export async function fetchCapacity(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<CapacityResponse> {
  const params = new URLSearchParams({ from, to })
  return request(`/api/capacity?${params}`, capacityResponseSchema, { signal })
}

export async function updateWeeklyHours(id: number, weeklyHours: number): Promise<Person> {
  return request(`/api/people/${id}`, personSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekly_hours: weeklyHours }),
  })
}

// ApiError is a non-2xx response; status tells callers whether retrying can help.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ResponseShapeError is a 2xx response that doesn't match its schema: a
// contract bug between API and client, never worth retrying.
export class ResponseShapeError extends Error {
  constructor(url: string, error: z.ZodError) {
    super(`Unexpected response from ${url}: ${z.prettifyError(error)}`)
    this.name = 'ResponseShapeError'
  }
}

async function request<S extends z.ZodType>(
  url: string,
  schema: S,
  init: RequestInit,
): Promise<z.output<S>> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(body?.error ?? `${res.status} ${res.statusText}`, res.status)
  }
  const parsed = schema.safeParse(await res.json())
  if (!parsed.success) {
    throw new ResponseShapeError(url, parsed.error)
  }
  return parsed.data
}
