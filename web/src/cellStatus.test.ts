import { describe, expect, it } from 'vitest'
import { cellStatus, isOver } from './cellStatus'

const cell = (allocated: number, capacity: number) => ({ week: '2026-01-05', allocated, capacity })

describe('cellStatus', () => {
  it.each([
    ['nothing allocated', cell(0, 40), { kind: 'empty' }],
    ['nothing allocated, no capacity', cell(0, 0), { kind: 'empty' }],
    ['under capacity', cell(32, 40), { kind: 'under' }],
    ['exactly at capacity', cell(40, 40), { kind: 'full' }],
    ['fractional, exactly at capacity', cell(37.5, 37.5), { kind: 'full' }],
    ['over capacity', cell(45, 40), { kind: 'over', overBy: 5 }],
    ['any hours against zero capacity', cell(20, 0), { kind: 'over', overBy: 20 }],
  ])('%s', (_, input, want) => {
    expect(cellStatus(input)).toEqual(want)
  })

  it('isOver matches the over status only', () => {
    expect([cell(45, 40), cell(40, 40), cell(0, 0), cell(20, 0)].map(isOver)).toEqual([
      true,
      false,
      false,
      true,
    ])
  })
})
