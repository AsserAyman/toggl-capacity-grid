export type WeekCapacity = {
  allocated: number
  capacity: number
}

export type PersonCapacity = {
  id: number
  name: string
  weekly_hours: number
  // Aligned index-for-index with CapacityResponse.weeks.
  weeks: WeekCapacity[]
}

export type CapacityResponse = {
  // Whole weeks: from is a Monday, to is a Sunday. May be wider than requested.
  from: string
  to: string
  weeks: string[]
  people: PersonCapacity[]
}

export type Person = {
  id: number
  name: string
  weekly_hours: number
}

export async function fetchCapacity(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<CapacityResponse> {
  const params = new URLSearchParams({ from, to })
  return request(`/api/capacity?${params}`, { signal })
}

export async function updateWeeklyHours(id: number, weeklyHours: number): Promise<Person> {
  return request(`/api/people/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekly_hours: weeklyHours }),
  })
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}
