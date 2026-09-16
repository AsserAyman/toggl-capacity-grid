import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { isIsoDate } from './dates'

export type Range = {
  from: string
  to: string
}

// push: a discrete step the Back button should undo (week buttons).
// replace: a continuous edit that would otherwise flood history (a date input
// fires once per day/month/year segment).
export type HistoryMode = 'push' | 'replace'

// The URL is the only store for the range: ?from=YYYY-MM-DD&to=YYYY-MM-DD.
// Links reproduce a view, Back/Forward move through it, and other query params
// (e.g. a future timeline on the same page) are left untouched.

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

const getSearch = () => window.location.search

export function parseRange(search: string): Range | null {
  const params = new URLSearchParams(search)
  const from = params.get('from')
  const to = params.get('to')
  if (!from || !to || !isIsoDate(from) || !isIsoDate(to) || from > to) return null
  return { from, to }
}

// useRangeFromUrl returns the range in the URL, or `fallback` when the URL has
// none or an invalid one. `fallback` should be a stable (module-level) object.
export function useRangeFromUrl(fallback: Range) {
  const search = useSyncExternalStore(subscribe, getSearch)
  const range = useMemo(() => parseRange(search) ?? fallback, [search, fallback])

  const setRange = useCallback((next: Range, mode: HistoryMode) => {
    const params = new URLSearchParams(window.location.search)
    params.set('from', next.from)
    params.set('to', next.to)
    const url = `${window.location.pathname}?${params}${window.location.hash}`
    if (mode === 'push') window.history.pushState(null, '', url)
    else window.history.replaceState(null, '', url)
    // pushState/replaceState don't fire popstate; tell subscribers ourselves.
    listeners.forEach((listener) => listener())
  }, [])

  return [range, setRange] as const
}
