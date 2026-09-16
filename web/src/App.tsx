import { useState } from 'react'
import { CapacityGrid } from './CapacityGrid'
import { RangeControls, type Range } from './RangeControls'

// The range the grid opens on. The controls move it from there.
const FROM = '2025-12-29'
const TO = '2026-01-16'

export function App() {
  const [range, setRange] = useState<Range>({ from: FROM, to: TO })

  return (
    <main>
      <h1>Team capacity</h1>
      <RangeControls range={range} onChange={setRange} />
      <CapacityGrid from={range.from} to={range.to} />
    </main>
  )
}
