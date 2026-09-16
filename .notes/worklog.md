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
