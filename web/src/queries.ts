import {
  QueryClient,
  keepPreviousData,
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
      // A 4xx (bad range, unknown person) won't fix itself; only retry what might.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof ApiError && error.status < 500),
    },
  },
})

export const capacityKeys = {
  all: ['capacity'] as const,
  range: (from: string, to: string) => [...capacityKeys.all, from, to] as const,
}

// useCapacity loads whole weeks. The key is the widened Monday–Sunday range the
// API will answer with, so e.g. Tue→Thu and Mon→Fri of the same week share a
// cache entry.
export function useCapacity(from: string, to: string) {
  const weekFrom = mondayOf(from)
  const weekTo = addDays(mondayOf(to), 6)
  return useQuery({
    queryKey: capacityKeys.range(weekFrom, weekTo),
    queryFn: ({ signal }) => fetchCapacity(weekFrom, weekTo, signal),
    // Keep the previous range on screen while the next one loads. Placeholder
    // data is dropped if the new range errors, so an old grid never sits under
    // a new range's error.
    placeholderData: keepPreviousData,
  })
}

export function useUpdateWeeklyHours() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, weeklyHours }: { id: number; weeklyHours: number }) =>
      updateWeeklyHours(id, weeklyHours),
    // Every cached range contains this person, not just the visible one, so
    // invalidate them all. Returning the promise keeps the mutation pending until
    // the visible range has refetched: when "Saving…" clears, the grid is right.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: capacityKeys.all }),
  })
}
