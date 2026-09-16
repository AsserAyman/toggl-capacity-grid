# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

## Data findings (before writing code)

- `hours_per_day` is never > 1.0 because each real assignment is fragmented into 15 rows
  (14 × x + 1 × 2x = 16x). Ana's `0.5` rows are really 8h/day. Rows must be **summed**, never deduped.
- 46,665 assignments end on a Sat/Sun (e.g. Mon–Sun). No assignment *starts* on a weekend.
  Decision: hours_per_day applies to **Mon–Fri only**. Counting calendar days would put Ana at
  56h/40 in the week of 2025-12-29 instead of 40/40.
- People 1–5 are hand-built edge cases, used as the reference numbers to verify against:
  Ana 40/0/30 of 40 (weekend tail), Bo 0/32/8 (Fri→Mon spans a week boundary),
  Cem 4/12 of 20, Dee 45 (overlapping assignments, over) / 40 (exactly at capacity),
  Eli 20h allocated against **0** capacity (no division by zero; counts as over).
- Weeks are ISO weeks starting Monday. Public holidays (Jan 1) are ignored — there is no
  calendar in the data.
- `weekly_hours` has no history: editing it changes capacity for every week, past included.
- Query computes per (assignment, week) the overlap of [start,end] with that week's Mon–Fri
  — closed form, no per-day `generate_series`. 52 weeks × 500 people ≈ 160ms, ~100ms of it JIT.

## API

- Shape: top-level `weeks` (Mondays) + per-person `weeks` cells aligned by index, each
  `{allocated, capacity}`. Capacity is per cell even though it's constant per person today,
  so holidays/part-time history can land later without changing the client contract.
- Range is widened to whole Mon–Sun weeks and echoed back as `from`/`to`; the client
  renders what the server says, not what it asked for. Capped at 53 weeks (year ≈ 120ms, 835KB).
- Go builds the week list once and passes it as `$1::date[]`; SQL never re-derives weeks, so
  header and cells can't disagree. (Week list also gives the planner a sane row estimate.)
- Errors are JSON `{"error": ...}` so the grid can show them.
- PATCH validates 0 ≤ weekly_hours ≤ 168, rejects unknown fields, 404 on missing person.
  Returns the person only — capacity maths lives in one place (the GET query).
- Verified via curl: people 1–5 match the hand-derived numbers above. Year scan: 0 non-0.5
  multiples (no float noise), max 45h.
- Seed quirk, not a bug: assignments only start every 3rd Monday and last 1–2 weeks, so every
  third week (2025-06-16, 2025-07-07, …) is empty for all 500 people. Week of 2026-01-05 only
  has the 5 hand-built people. After 2026-01-05 real starts resume on the same cycle.

## Web

- Range state lives in `App`, controls in `RangeControls` (page level), not inside the grid:
  the team overview page will drive the logged-time timeline off the same range.
- Initial range kept as the brief's 2025-12-29 → 2026-01-16 (it's where the hand-built
  people live); "This week" jumps to today. Prev/next shift by 7 days keeping the width.
  Moving `from` past `to` (or vice versa) drags the other end along instead of erroring.
- Dates are `YYYY-MM-DD` strings; arithmetic in UTC, "today" from local calendar parts —
  `toISOString()` for today would be off by one for anyone east/west of UTC near midnight.
- **After an edit: refetch the visible range.** PATCH → on success bump a reload key → the
  same effect that loads ranges refetches. Chose this over patching cells locally because
  per-week capacity is derived server-side; a local patch would duplicate that rule and
  silently go wrong once capacity varies by week (holidays, history). Cost is one ~6ms,
  ~77KB request for 3 weeks. Not optimistic: the grid dims ("Refreshing…") until it lands.
- Races: every load owns an AbortController aborted on cleanup, so a slow response for a
  range the user already left (or a pre-save refetch) can't overwrite newer data. Reasoned
  about, not reproduced with throttling.
- Over-allocation: red cell + left bar + "+Nh over" text (not colour alone); exactly at
  capacity is amber; per-week "N over" in the header; summary count; "only over-allocated"
  filter — with 500 people, scrolling to find red cells isn't "at a glance".
- Capacity 0 with 0 allocated renders "— / 0", not over. Capacity 0 with hours is over.

## Verification in the browser (default range)

- People 1–5 render the reference numbers. Header: Dec 29 39 over, Jan 5 15, Jan 12 0;
  41 of 500 over.
- Edit Dee 40→45: every cell in her row became /45, Jan 5 15→14 over, summary 41→40. No reload.
- Mis-click while testing saved Cem at 45 by accident; restored to 20 via the UI and
  confirmed in psql. Dee restored to 40 via curl. DB matches seed for weekly_hours again.
- Found & fixed: a failed range change (>53 weeks) left the *previous* range's grid on
  screen under the error. Now the old grid is only kept if it's the range being asked for.
- Server validation message shows inline in the editor (tested with browser validation off;
  normally `max=168` stops it first). PATCH curl cases: 400 range/unknown field/missing/bad
  id, 404 unknown person.
- Known gap: no live updates — an edit from another client (my curl restore) isn't
  visible until the next navigation/reload.
- Input has `step=0.5`, so the browser blocks e.g. 37.25 though the API accepts it.

## Move server state to TanStack Query

- Replaced the hand-rolled effect/AbortController/reloadKey with `useCapacity` + `useUpdateWeeklyHours`
  (`web/src/queries.ts`). Same behaviour, less code, and matches the team's stack.
- Query key is the widened Mon–Sun range (what the API answers), not the raw inputs, so
  equivalent requests share a cache entry.
- Caching introduced a new way to be wrong: a save must invalidate **every** cached range
  (`['capacity']` prefix), not just the visible one — otherwise going back a week shows the old
  capacity. Verified: warmed Jan 5 range, edited Dee on Dec 29, navigated forward → /45.
- `onSuccess` returns the invalidation promise, so the mutation stays pending until the visible
  range has refetched. Verified with a MutationObserver: editing → saving (old numbers) →
  closed (new numbers) in one commit; never closed with old numbers.
  (First attempt sampled with requestAnimationFrame — paused in a background tab, inconclusive.)
- `keepPreviousData` while paging. Verified that a failing range (>53 weeks) drops the placeholder,
  so the old grid doesn't sit under the error — the manual `showsRequestedRange` check is gone.
- No retries on 4xx (`ApiError.status`); up to 2 on network/5xx. staleTime 30s, refetch on
  window focus left on — partly covers edits from other clients.
- Dropped neighbour-week prefetch I'd suggested: at 52 weeks it triples payload per navigation,
  and keepPreviousData already avoids the flash.

## Type safety: zod at the boundary, discriminated unions, noUncheckedIndexedAccess

- `api.ts` parses responses with zod instead of `as T`. The schema also enforces the one invariant
  the TS type can't express: every person has exactly one cell per week. A transform then attaches
  `week` to each cell, so the UI no longer indexes `person.weeks[i]` by the header's position.
- A 2xx that fails the schema throws `ResponseShapeError` — not retried (contract bug, not transient).
  Verified by patching `fetch` to drop one cell: grid replaced by "every person must have exactly one
  cell per week", fetched once in 4s. Control: a 500 retried at ~1s and ~2s. (An earlier untimed run
  counted 2 fetches for the broken range; not reproduced with timestamps — likely a window-focus
  refetch, not a retry.)
- Unions: `CellStatus` (`empty | under | full | over{overBy}`) with a `Record<kind, class>` so a new
  status can't ship unstyled; `EditorState` (`viewing | editing{draft, validationError}`);
  `ParsedHours` result type. Deliberately **no** `saving` mode — pending/error live in the mutation;
  mirroring them in local state would be two sources of truth. No fetch-state union either: Query's
  `status` already is one.
- `noUncheckedIndexedAccess` on. It found one real hole: `parseDate` destructured `split('-')`
  unchecked, so a malformed date became `Invalid Date` silently. Now throws.
- The one remaining `!` is `r.weeks[i]!` in the zod transform, directly after the refine that
  guarantees it.
- Still hand-duplicated: Go structs and zod schemas. With a week I'd generate one from the other
  (OpenAPI) rather than rely on the runtime check to catch drift.
- Re-verified in browser: reference numbers for people 1–5 and header counts unchanged; empty draft →
  "Enter a number"; server 400 shown inline; Dee 40→45→40 round trip updates cells + counts.
  52 weeks still ~1s in dev, same as before zod — virtualization (next step) is the fix there.

## Row virtualization + memoization

- `@tanstack/react-virtual` on rows only, inside the existing `<table>` using top/bottom spacer rows,
  so the sticky header and name column keep working. Rows are measured (heights differ: "+Nh over",
  open editor). Columns not virtualized — the API caps at 53.
- Baseline vs after, same conditions (dev build + StrictMode, background tab, 52 weeks × 500 people):
  | | before | after |
  |---|---|---|
  | 52-week uncached load | 1620ms | 267ms |
  | filter toggle | ~1100ms | ~70ms |
  | next week (uncached) | 2464ms | 174ms |
  | prev week (cached) | 2177ms | 54ms |
  | scroll to bottom | 829ms | 50ms |
  | DOM nodes | 64k | 3.4k |
- Memo: `PersonRow` is `memo`'d; `summarize` (26k cells) is `useMemo`'d on `data`. Verified with a
  temporary render counter (removed before commit): saving Dee re-rendered **only Dee's row** (2 =
  StrictMode) — so `virtualizer.measureElement` is identity-stable and Query's structural sharing keeps
  unchanged person objects identical through the zod transform. Opening the editor/typing: 0 row renders.
- Tradeoffs: off-screen people aren't in the DOM, so Cmd+F can't find them (a name search would fix it);
  an open editor scrolled far out of view unmounts and loses its draft (the save itself still completes
  and invalidates — the hook-level `onSuccess` runs regardless of mount).
- Header height isn't passed as `scrollMargin`; overscan of 10 rows absorbs the ~50px offset.
- Not a bug, but I checked: people sort by Postgres `en_US.utf8` collation (Šimunović after Wiśniewski,
  non-Latin scripts after Z). A browser `localeCompare` check disagreed on a few, which is collation, not
  virtualization.
- Correction to the entry above: "hook-level `onSuccess` runs regardless of mount" is from the TanStack
  Query docs (mutate()-level callbacks don't fire after unmount; useMutation-level ones do). Not tested here.

## Range in the URL

- `?from=&to=` via a hand-rolled `useRangeFromUrl` (no react-router for one param pair). The URL is the
  only store: read with `useSyncExternalStore` (popstate + our own notify, since pushState doesn't fire
  popstate), so there's no useState copy to drift from the address bar.
- Week buttons / "This week" **push** (Back undoes a step); date inputs **replace** — Chrome fires change
  per day/month/year segment, which would flood history. Consequence: Back skips over typed-date edits
  to the last button step. Deliberate.
- Other query params are preserved, for whatever else lands on the overview page.
- Invalid URL (malformed, impossible date like 2026-02-31, from > to) → default range. The bad params stay
  in the address bar until the next navigation rewrites them; I didn't add an effect to strip them.
- No params → default range and a clean URL; params only appear after the first change.
- Verified in browser: push/back/forward/back-to-no-params; 3 date edits left history.length unchanged;
  deep link with `team=design` opened on Mar 2 and kept `team` after Week →; the three invalid links fell
  back to Dec 29.

## Tests — Go

- Run (no local Go; doesn't touch Makefile/compose — uses the compose network and seeded db):
  `docker run --rm --network toggl-assessment_default -v "$PWD/api":/src -v capacity-gomodcache:/go/pkg/mod -w /src -e DATABASE_URL='postgres://capacity:capacity@db:5432/capacity?sslmode=disable' golang:1.26-alpine go test ./...`
  Without `DATABASE_URL` the integration tests skip and unit tests still run.
- Unit: `parseWeekRange` (widening, Sunday, year boundary, 53-week cap, bad input); PATCH validation
  through the real router with a nil db — proves validation runs before any query.
- Integration: people 1–5 reference numbers (the hand-derived ones above), one cell per week for all
  500; PATCH→GET shows new capacity in every week with allocation unchanged; unknown person → 404.
- Extracted `s.routes()` from `main()` so tests hit production routing (method + `{id}` patterns).
- The write test changes Dee and restores the original in `t.Cleanup` via SQL (not via the API under
  test). A killed test process would leave it changed — `make reset` fixes that.
- Checked the tests can fail: counting Mon–Sun instead of Mon–Fri made the reference test fail with
  "Ana … got 56/40, want 40/40 (weekend days carry no hours)" and caught Bo's boundary split too.
