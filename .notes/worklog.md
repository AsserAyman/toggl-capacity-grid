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
