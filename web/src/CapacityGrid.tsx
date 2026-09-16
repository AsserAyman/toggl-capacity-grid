import { useState } from 'react'
import type { PersonCapacity, WeekCapacity } from './api'
import { addDays, formatShort } from './dates'
import { useCapacity, useUpdateWeeklyHours } from './queries'

type Props = {
  from: string
  to: string
}

const hours = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })

const isOver = (week: WeekCapacity) => week.allocated > week.capacity

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

// CapacityGrid renders one row per person and one column per week, showing
// how allocated each person is and making over-allocation obvious.
//
// After a person's weekly hours are saved, every cached range is invalidated
// and the visible one refetched, rather than patching cells locally: how
// capacity is derived per week lives only in the API, so the client never has
// to re-implement it.
export function CapacityGrid({ from, to }: Props) {
  const { data, error, isFetching, isPlaceholderData, refetch } = useCapacity(from, to)
  const [onlyOver, setOnlyOver] = useState(false)

  const retry = () => void refetch()

  if (!data) {
    return error ? <ErrorBanner message={errorMessage(error)} onRetry={retry} /> : <p>Loading…</p>
  }

  const overByWeek = data.weeks.map((_, i) => data.people.filter((p) => isOver(p.weeks[i])).length)
  const overPeople = data.people.filter((p) => p.weeks.some(isOver))
  const rows = onlyOver ? overPeople : data.people

  return (
    <section className="capacity" aria-busy={isFetching}>
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
        {isFetching && <span className="muted">Refreshing…</span>}
      </div>

      {/* Background refetch failed: the grid below is still this range, just not fresh. */}
      {error && <ErrorBanner message={errorMessage(error)} onRetry={retry} />}

      <div className={`grid-scroll${isPlaceholderData ? ' is-stale' : ''}`}>
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
                  <PersonCell person={person} />
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

function PersonCell({ person }: { person: PersonCapacity }) {
  const mutation = useUpdateWeeklyHours()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const saving = mutation.isPending
  const error = validationError ?? (mutation.error ? errorMessage(mutation.error) : null)

  const startEditing = () => {
    setDraft(String(person.weekly_hours))
    setValidationError(null)
    mutation.reset()
    setEditing(true)
  }

  const save = () => {
    const value = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(value)) {
      setValidationError('Enter a number')
      return
    }
    setValidationError(null)
    if (value === person.weekly_hours) {
      setEditing(false)
      return
    }
    mutation.mutate({ id: person.id, weeklyHours: value }, { onSuccess: () => setEditing(false) })
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
        save()
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
          if (e.key === 'Escape' && !saving) setEditing(false)
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
