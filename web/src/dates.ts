// Dates travel as 'YYYY-MM-DD' strings. Arithmetic happens in UTC so the
// viewer's timezone can never shift a day across a week boundary.

export function parseDate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) throw new Error(`expected YYYY-MM-DD, got ${JSON.stringify(iso)}`)
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

// isIsoDate rejects malformed strings and impossible dates like 2026-02-31,
// which Date.UTC would silently roll over into March.
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && formatDate(parseDate(value)) === value
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  const date = parseDate(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return formatDate(date)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000)
}

export function mondayOf(iso: string): string {
  const daysSinceMonday = (parseDate(iso).getUTCDay() + 6) % 7
  return addDays(iso, -daysSinceMonday)
}

// today is the viewer's local calendar date, not the UTC one.
export function today(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const shortFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

export function formatShort(iso: string): string {
  return shortFormat.format(parseDate(iso))
}
