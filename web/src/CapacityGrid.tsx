import { useState } from 'react'
import type { PersonCapacity, WeekCapacity } from './api'
import { addDays, formatShort } from './dates'
import { useCapacity, useUpdateWeeklyHours } from './queries'

type Props = {
  from: string
  to: string
}

const hours = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

type CellStatus =
  | { kind: 'empty' } // nothing allocated, whatever the capacity
  | { kind: 'under' }
  | { kind: 'full' }
  | { kind: 'over'; overBy: number } // includes any hours against zero capacity

function cellStatus({ allocated, capacity }: WeekCapacity): CellStatus {
  if (allocated === 0) return { kind: 'empty' }
  if (allocated > capacity) return { kind: 'over', overBy: allocated - capacity }
  return allocated === capacity ? { kind: 'full' } : { kind: 'under' }
}

const isOver = (week: WeekCapacity) => cellStatus(week).kind === 'over'

// A Record over the union's kinds: adding a status without a style won't compile.
const cellClass: Record<CellStatus['kind'], string> = {
  empty: 'cell cell-empty',
  under: 'cell cell-under',
  full: 'cell cell-full',
  over: 'cell cell-over',
}

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

  const overByWeek = new Map<string, number>()
  for (const person of data.people) {
    for (const cell of person.weeks) {
      if (isOver(cell)) overByWeek.set(cell.week, (overByWeek.get(cell.week) ?? 0) + 1)
    }
  }
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
              {data.weeks.map((week) => {
                const over = overByWeek.get(week) ?? 0
                return (
                  <th scope="col" key={week}>
                    <div title={`${week} to ${addDays(week, 6)}`}>{formatShort(week)}</div>
                    <div className={over > 0 ? 'over-text small' : 'muted small'}>{over} over</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((person) => (
              <tr key={person.id}>
                <th scope="row" className="person-col">
                  <PersonCell person={person} />
                </th>
                {person.weeks.map((cell) => (
                  <CapacityCell key={cell.week} cell={cell} />
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

function CapacityCell({ cell }: { cell: WeekCapacity }) {
  const status = cellStatus(cell)
  const capacity = hours.format(cell.capacity)

  if (status.kind === 'empty') {
    return (
      <td className={cellClass.empty}>
        <span className="muted">— / {capacity}</span>
      </td>
    )
  }

  return (
    <td
      className={cellClass[status.kind]}
      title={`${hours.format(cell.allocated)}h allocated of ${capacity}h`}
    >
      <span className="allocated">{hours.format(cell.allocated)}</span>
      <span className="muted"> / {capacity}</span>
      {status.kind === 'over' && (
        <div className="small over-text">+{hours.format(status.overBy)}h over</div>
      )}
    </td>
  )
}

// Whether a save is in flight or failed is server state and lives in the
// mutation; this only tracks what the user is doing with the input.
type EditorState =
  | { mode: 'viewing' }
  | { mode: 'editing'; draft: string; validationError: string | null }

type ParsedHours = { ok: true; value: number } | { ok: false; error: string }

function parseHours(draft: string): ParsedHours {
  const value = Number(draft)
  if (draft.trim() === '' || !Number.isFinite(value)) return { ok: false, error: 'Enter a number' }
  return { ok: true, value }
}

function PersonCell({ person }: { person: PersonCapacity }) {
  const mutation = useUpdateWeeklyHours()
  const [editor, setEditor] = useState<EditorState>({ mode: 'viewing' })

  if (editor.mode === 'viewing') {
    const startEditing = () => {
      mutation.reset()
      setEditor({ mode: 'editing', draft: String(person.weekly_hours), validationError: null })
    }
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

  const saving = mutation.isPending
  const error = editor.validationError ?? (mutation.error ? errorMessage(mutation.error) : null)
  const stopEditing = () => setEditor({ mode: 'viewing' })

  const save = () => {
    const parsed = parseHours(editor.draft)
    if (!parsed.ok) {
      setEditor({ ...editor, validationError: parsed.error })
      return
    }
    if (parsed.value === person.weekly_hours) {
      stopEditing()
      return
    }
    setEditor({ ...editor, validationError: null })
    mutation.mutate({ id: person.id, weeklyHours: parsed.value }, { onSuccess: stopEditing })
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
        value={editor.draft}
        autoFocus
        disabled={saving}
        aria-label={`Weekly hours for ${person.name}`}
        onChange={(e) => setEditor({ ...editor, draft: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !saving) stopEditing()
        }}
      />
      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" disabled={saving} onClick={stopEditing}>
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
