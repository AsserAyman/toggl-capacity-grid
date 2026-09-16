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
