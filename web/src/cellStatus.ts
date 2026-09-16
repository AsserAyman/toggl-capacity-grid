import type { WeekCapacity } from './api'

export type CellStatus =
  | { kind: 'empty' } // nothing allocated, whatever the capacity
  | { kind: 'under' }
  | { kind: 'full' }
  | { kind: 'over'; overBy: number } // includes any hours against zero capacity

export function cellStatus({ allocated, capacity }: WeekCapacity): CellStatus {
  if (allocated === 0) return { kind: 'empty' }
  if (allocated > capacity) return { kind: 'over', overBy: allocated - capacity }
  return allocated === capacity ? { kind: 'full' } : { kind: 'under' }
}

export const isOver = (week: WeekCapacity) => cellStatus(week).kind === 'over'
