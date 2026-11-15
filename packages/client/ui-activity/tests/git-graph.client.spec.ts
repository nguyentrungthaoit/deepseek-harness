/** Lane layout: straight history, a merge with a side branch, and a commit list cut mid-branch. */
import { describe, expect, it } from 'vitest'
import { layoutGraph } from '../src/client/git-graph.ts'

const commit = (hash: string, ...parents: string[]) => ({ hash, parents, time: 0, subject: hash })

describe('layoutGraph', () => {
  it('keeps a linear history in one lane', () => {
    const { rows, lanes } = layoutGraph([commit('c', 'b'), commit('b', 'a'), commit('a')])
    expect(lanes).toBe(1)
    expect(rows.map(row => [row.lane, row.fromAbove, row.passing, row.next])).toEqual([
      [0, false, [], [0]],
      [0, true, [], [0]],
      [0, true, [], []],
    ])
  })

  it('opens a lane for a merge second parent and closes it where the branches meet', () => {
    const { rows, lanes } = layoutGraph([
      commit('m', 'x', 's'),
      commit('x', 'r'),
      commit('s', 'r'),
      commit('r'),
    ])
    expect(lanes).toBe(2)
    expect(rows[0]).toMatchObject({ lane: 0, fromAbove: false, next: [0, 1] })
    expect(rows[1]).toMatchObject({ lane: 0, fromAbove: true, passing: [1], next: [0] })
    expect(rows[2]).toMatchObject({ lane: 1, fromAbove: true, passing: [0], next: [1] })
    // Both lanes expect `r`: the dot takes the first and the second ends there.
    expect(rows[3]).toMatchObject({ lane: 0, fromAbove: true, converging: [1], passing: [] })
  })

  it('links a merge to a lane that already heads for its second parent', () => {
    const { rows } = layoutGraph([commit('a', 'p'), commit('b', 'q'), commit('m', 'a2', 'q'), commit('a2'), commit('q')])
    expect(rows[0]).toMatchObject({ lane: 0, next: [0] })
    expect(rows[1]).toMatchObject({ lane: 1, passing: [0], next: [1] })
    // `m` is not expected by any lane, so it takes the free lane 2 and joins lane 1 for `q`.
    expect(rows[2]).toMatchObject({ lane: 2, fromAbove: false, passing: [0, 1], next: [2, 1] })
  })

  it('reuses a freed lane for the next unexpected commit', () => {
    const { rows } = layoutGraph([commit('a', 'p'), commit('p'), commit('b', 'q')])
    expect(rows[2]).toMatchObject({ lane: 0, fromAbove: false })
  })

  it('lays out nothing for no commits', () => {
    expect(layoutGraph([])).toEqual({ rows: [], lanes: 1 })
  })
})
