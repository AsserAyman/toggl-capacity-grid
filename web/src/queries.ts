import {
  QueryClient,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ApiError, fetchCapacity, updateWeeklyHours } from './api'
import { addDays, mondayOf } from './dates'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => failureCount < 2 && isTransient(error),
    },
  },
})

// Only network failures and 5xx might succeed on a second try. A 4xx (bad range,
// unknown person) or a ResponseShapeError won't fix itself.
export function isTransient(error: Error): boolean {
  if (error instanceof ApiError) return error.status >= 500
  return error instanceof TypeError // fetch rejects with TypeError when the network fails
}

export const capacityKeys = {
  all: ['capacity'] as const,
  range: (from: string, to: string) => [...capacityKeys.all, from, to] as const,
}

// capacityQueryOptions loads whole weeks. The key is the widened Monday–Sunday
// range the API will answer with, so e.g. Tue→Thu and Mon→Fri of the same week
// share a cache entry.
export function capacityQueryOptions(from: string, to: string) {
  const weekFrom = mondayOf(from)
  const weekTo = addDays(mondayOf(to), 6)
  return queryOptions({
    queryKey: capacityKeys.range(weekFrom, weekTo),
    queryFn: ({ signal }) => fetchCapacity(weekFrom, weekTo, signal),
  })
}

export function useCapacity(from: string, to: string) {
  return useQuery({
    ...capacityQueryOptions(from, to),
    // Keep the previous range on screen while the next one loads. Placeholder
    // data is dropped if the new range errors, so an old grid never sits under
    // a new range's error.
    placeholderData: keepPreviousData,
  })
}

export function updateWeeklyHoursOptions(client: QueryClient) {
  return {
    mutationFn: ({ id, weeklyHours }: { id: number; weeklyHours: number }) =>
      updateWeeklyHours(id, weeklyHours),
    // Every cached range contains this person, not just the visible one, so
    // invalidate them all. Returning the promise keeps the mutation pending until
    // the visible range has refetched: when "Saving…" clears, the grid is right.
    onSuccess: () => client.invalidateQueries({ queryKey: capacityKeys.all }),
  }
}

export function useUpdateWeeklyHours() {
  const client = useQueryClient()
  return useMutation(updateWeeklyHoursOptions(client))
}
