import { memo, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { CapacityResponse, PersonCapacity, WeekCapacity } from './api'
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

  // Walks every cell (26k at 52 weeks); only redo it when the data changes,
  // not when the filter or the fetching flag does.
  const summary = useMemo(() => (data ? summarize(data) : null), [data])

  const retry = () => void refetch()

  if (!data || !summary) {
    return error ? <ErrorBanner message={errorMessage(error)} onRetry={retry} /> : <p>Loading…</p>
  }

  const rows = onlyOver ? summary.overPeople : data.people

  return (
    <section className="capacity" aria-busy={isFetching}>
      <div className="capacity-summary">
        <span className="range">
          {formatShort(data.from)} – {formatShort(data.to)}, {data.weeks.length}{' '}
          {data.weeks.length === 1 ? 'week' : 'weeks'}
        </span>
        <span>
          <strong className={summary.overPeople.length > 0 ? 'over-text' : undefined}>
            {summary.overPeople.length}
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

      <CapacityTable
        weeks={data.weeks}
        rows={rows}
        overByWeek={summary.overByWeek}
        stale={isPlaceholderData}
      />
    </section>
  )
}

function summarize(data: CapacityResponse) {
  const overByWeek = new Map<string, number>()
  const overPeople: PersonCapacity[] = []
  for (const person of data.people) {
    let personOver = false
    for (const cell of person.weeks) {
      if (!isOver(cell)) continue
      personOver = true
      overByWeek.set(cell.week, (overByWeek.get(cell.week) ?? 0) + 1)
    }
    if (personOver) overPeople.push(person)
  }
  return { overByWeek, overPeople }
}

// Rows are virtualized: at 52 weeks × 500 people the full table is ~64k DOM
// nodes. Columns aren't — the API caps a range at 53 weeks, so a rendered row
// window stays small. Off-screen people are not in the DOM, so browser
// find-in-page won't see them.
function CapacityTable({
  weeks,
  rows,
  overByWeek,
  stale,
}: {
  weeks: string[]
  rows: PersonCapacity[]
  overByWeek: Map<string, number>
  stale: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    getItemKey: (index) => rows[index]?.id ?? index,
    // Generous overscan also absorbs the header's height, which offsets rows
    // from the virtualizer's scroll origin.
    overscan: 10,
  })

  const items = virtualizer.getVirtualItems()
  const paddingTop = items[0]?.start ?? 0
  const paddingBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0)
  const columns = weeks.length + 1

  return (
    <div ref={scrollRef} className={`grid-scroll${stale ? ' is-stale' : ''}`}>
      <table aria-rowcount={rows.length + 1}>
        <thead>
          <tr aria-rowindex={1}>
            <th scope="col" className="person-col">
              Person <span className="muted">· weekly hours</span>
            </th>
            {weeks.map((week) => {
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
          {paddingTop > 0 && <SpacerRow height={paddingTop} columns={columns} />}
          {items.map((item) => {
            const person = rows[item.index]
            return (
              person && (
                <PersonRow
                  key={person.id}
                  person={person}
                  index={item.index}
                  measureRef={virtualizer.measureElement}
                />
              )
            )
          })}
          {paddingBottom > 0 && <SpacerRow height={paddingBottom} columns={columns} />}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns} className="muted">
                Nobody is over capacity in this range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const ROW_HEIGHT_ESTIMATE = 41

function SpacerRow({ height, columns }: { height: number; columns: number }) {
  return (
    <tr aria-hidden="true" className="spacer">
      <td colSpan={columns} style={{ height }} />
    </tr>
  )
}

// Memoized so a refetch re-renders only the people whose data changed:
// TanStack Query's structural sharing keeps unchanged person objects identical.
const PersonRow = memo(function PersonRow({
  person,
  index,
  measureRef,
}: {
  person: PersonCapacity
  index: number
  measureRef: (node: Element | null) => void
}) {
  return (
    // Rows differ in height ("+Nh over", an open editor), so each is measured.
    <tr ref={measureRef} data-index={index} aria-rowindex={index + 2}>
      <th scope="row" className="person-col">
        <PersonCell person={person} />
      </th>
      {person.weeks.map((cell) => (
        <CapacityCell key={cell.week} cell={cell} />
      ))}
    </tr>
  )
})

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
