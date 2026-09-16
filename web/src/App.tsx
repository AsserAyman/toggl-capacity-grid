import { CapacityGrid } from './CapacityGrid'
import { RangeControls } from './RangeControls'
import { useRangeFromUrl, type Range } from './useRangeFromUrl'

// The range the grid opens on when the URL doesn't carry one.
const DEFAULT_RANGE: Range = { from: '2025-12-29', to: '2026-01-16' }

export function App() {
  const [range, setRange] = useRangeFromUrl(DEFAULT_RANGE)

  return (
    <main>
      <h1>Team capacity</h1>
      <RangeControls range={range} onChange={setRange} />
      <CapacityGrid from={range.from} to={range.to} />
    </main>
  )
}
