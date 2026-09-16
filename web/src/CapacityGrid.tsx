import { useEffect, useState } from 'react'
import {
  fetchCapacity,
  updateWeeklyHours,
  type CapacityResponse,
  type PersonCapacity,
  type WeekCapacity,
} from './api'
import { addDays, formatShort, mondayOf } from './dates'

type Props = {
  from: string
  to: string
}

const hours = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })

const isOver = (week: WeekCapacity) => week.allocated > week.capacity

// CapacityGrid renders one row per person and one column per week, showing
// how allocated each person is and making over-allocation obvious.
//
// After a person's weekly hours are saved, the grid refetches the whole range
// rather than patching cells locally: how capacity is derived per week lives
// only in the API, so the client never has to re-implement it.
export function CapacityGrid({ from, to }: Props) {
  const [data, setData] = useState<CapacityResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [onlyOver, setOnlyOver] = useState(false)

  useEffect(() => {
    // Aborting on cleanup means a slow response for a range (or a pre-save
    // state) the user has already moved past can never overwrite newer data.
    const controller = new AbortController()
    setLoading(true)
    fetchCapacity(from, to, controller.signal)
      .then((next) => {
        setData(next)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => controller.abort()
  }, [from, to, reloadKey])

  const reload = () => setReloadKey((k) => k + 1)

  // After a failed range change, `data` still holds the previous range. Keep it
  // on screen only while it answers the question being asked (e.g. a refresh
  // after save failed); never show old weeks under a new range.
  const showsRequestedRange =
    data !== null && data.from === mondayOf(from) && data.to === addDays(mondayOf(to), 6)

  if (!data || (error && !showsRequestedRange)) {
    return error ? <ErrorBanner message={error} onRetry={reload} /> : <p>Loading…</p>
  }

  const overByWeek = data.weeks.map((_, i) => data.people.filter((p) => isOver(p.weeks[i])).length)
  const overPeople = data.people.filter((p) => p.weeks.some(isOver))
  const rows = onlyOver ? overPeople : data.people

  return (
    <section className="capacity" aria-busy={loading}>
      <div className="capacity-summary">
        <span className="range">
          {formatShort(data.from)} – {formatShort(data.to)}, {data.weeks.length}{' '}
          {data.weeks.length === 1 ? 'week' : 'weeks'}
        </span>
        <span>
          <strong className={overPeople.length > 0 ? 'over-text' : undefined}>
            {overPeople.length}
          </strong>{' '}
          of {data.people.length} people over capacity in at least one week
        </span>
        <label>
          <input type="checkbox" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)} />{' '}
          Only show over-allocated
        </label>
        {loading && <span className="muted">Refreshing…</span>}
      </div>

      {error && <ErrorBanner message={error} onRetry={reload} />}

      <div className={`grid-scroll${loading ? ' is-stale' : ''}`}>
        <table>
          <thead>
            <tr>
              <th scope="col" className="person-col">
                Person <span className="muted">· weekly hours</span>
              </th>
              {data.weeks.map((week, i) => (
                <th scope="col" key={week}>
                  <div title={`${week} to ${addDays(week, 6)}`}>{formatShort(week)}</div>
                  <div className={overByWeek[i] > 0 ? 'over-text small' : 'muted small'}>
                    {overByWeek[i]} over
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((person) => (
              <tr key={person.id}>
                <th scope="row" className="person-col">
                  <PersonCell person={person} onSaved={reload} />
                </th>
                {person.weeks.map((week, i) => (
                  <CapacityCell key={data.weeks[i]} week={week} />
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={data.weeks.length + 1} className="muted">
                  Nobody is over capacity in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CapacityCell({ week }: { week: WeekCapacity }) {
  const { allocated, capacity } = week

  if (allocated === 0) {
    return (
      <td className="cell cell-empty">
        <span className="muted">— / {hours.format(capacity)}</span>
      </td>
    )
  }

  const over = allocated - capacity
  const state = over > 0 ? 'over' : over === 0 ? 'full' : 'under'
  return (
    <td className={`cell cell-${state}`} title={`${hours.format(allocated)}h allocated of ${hours.format(capacity)}h`}>
      <span className="allocated">{hours.format(allocated)}</span>
      <span className="muted"> / {hours.format(capacity)}</span>
      {over > 0 && <div className="small over-text">+{hours.format(over)}h over</div>}
    </td>
  )
}

function PersonCell({ person, onSaved }: { person: PersonCapacity; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEditing = () => {
    setDraft(String(person.weekly_hours))
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    const value = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(value)) {
      setError('Enter a number')
      return
    }
    if (value === person.weekly_hours) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateWeeklyHours(person.id, value)
      setEditing(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="person">
        <span className="name">{person.name}</span>
        <button
          type="button"
          className="hours-button"
          onClick={startEditing}
          title="Edit weekly hours (applies to every week)"
        >
          {hours.format(person.weekly_hours)}h/wk
        </button>
      </div>
    )
  }

  return (
    <form
      className="person"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <span className="name">{person.name}</span>
      <input
        type="number"
        min={0}
        max={168}
        step={0.5}
        value={draft}
        autoFocus
        disabled={saving}
        aria-label={`Weekly hours for ${person.name}`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false)
        }}
      />
      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" disabled={saving} onClick={() => setEditing(false)}>
        Cancel
      </button>
      {error && <div className="small over-text">{error}</div>}
    </form>
  )
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error" role="alert">
      Couldn’t load capacity: {message}{' '}
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}
