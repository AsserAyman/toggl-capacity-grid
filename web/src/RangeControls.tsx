import { addDays, daysBetween, mondayOf, today } from './dates'

export type Range = {
  from: string
  to: string
}

type Props = {
  range: Range
  onChange: (range: Range) => void
}

// RangeControls sits at page level rather than inside the grid: the team
// overview page will drive other views (the logged-time timeline) from the
// same range.
export function RangeControls({ range, onChange }: Props) {
  const shift = (days: number) =>
    onChange({ from: addDays(range.from, days), to: addDays(range.to, days) })

  const jumpToThisWeek = () => {
    const from = mondayOf(today())
    onChange({ from, to: addDays(from, daysBetween(range.from, range.to)) })
  }

  // Keep the range valid while typing: moving one end past the other drags it along.
  const setFrom = (from: string) => {
    if (from) onChange({ from, to: from > range.to ? from : range.to })
  }
  const setTo = (to: string) => {
    if (to) onChange({ from: to < range.from ? to : range.from, to })
  }

  return (
    <div className="range-controls">
      <button type="button" onClick={() => shift(-7)} aria-label="Previous week">
        ← Week
      </button>
      <button type="button" onClick={jumpToThisWeek}>
        This week
      </button>
      <button type="button" onClick={() => shift(7)} aria-label="Next week">
        Week →
      </button>
      <label>
        From <input type="date" value={range.from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label>
        To <input type="date" value={range.to} onChange={(e) => setTo(e.target.value)} />
      </label>
    </div>
  )
}
