# Decisions

## What did the spec not tell you?

- Each assignment is split into 15 rows: 14 with x hours per day and one with 2x, so 16x in total. I sum the rows (Ana's 0.5 rows are 8h/day). Keeping one row per assignment means nobody is ever over.
- Only Mon–Fri count. Capacity is a 5 day week and many assignments end on Sat/Sun, counting those puts Ana at 56h of 40.
- 0 capacity with hours is over (Eli). Exactly full is not over.
- Editing weekly hours changes past weeks too, there's no history in the schema.
- After a save, every cached range is marked stale and the visible one refetches before "Saving…" clears. Other ranges refetch when you navigate to them. No local patching, so the capacity calculation stays only in the API.
- API shape: `weeks` (list of Mondays) once at the top, and each person has `{allocated, capacity}` cells in the same order. Capacity is per cell even though it's constant today, so it can vary per week later without changing the client.
- Client: aggregations in the DB, TanStack Query for server state, range kept in the URL (no Zustand), Zod + discriminated unions for type safety, virtualization + memoization since a year is 500 × 53 cells.

## What did you notice that looked wrong?

- Every third week is empty for the whole team.
- No holidays. Jan 1 counts as a working day.
- The AI worklog said Jan 5 was the near-empty week, it's actually Jan 12 (only the hand-built people).

## What did the AI get wrong that you caught?

- It was returning the db error to the client including SQL details.

## What would you do differently with a week?

- Capacity history, so edits don't rewrite past weeks.
- Holidays and time off per person.
- Per project breakdown and search by name.