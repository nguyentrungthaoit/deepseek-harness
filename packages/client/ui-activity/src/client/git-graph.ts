/**
 * Lane layout of a commit list for the mini graph: which lane each commit's
 * dot sits in, which lanes run past it, and where its parent lines go.
 */
import type { WorkspaceCommit } from '@deepseek-ai/dsh-workspace-changes/types'

/** One commit row of the graph. Lane numbers count from 0 at the left. */
export interface GraphRow {
  readonly commit: WorkspaceCommit
  /** Lane of the commit's dot. */
  readonly lane: number
  /** Whether a line arrives at the dot from the row above. */
  readonly fromAbove: boolean
  /** Other lanes whose lines end at this dot, drawn from the row above. */
  readonly converging: readonly number[]
  /** Lanes whose lines run through the whole row. */
  readonly passing: readonly number[]
  /** Lanes the dot's parent lines continue into below, first parent first. */
  readonly next: readonly number[]
}

/** The laid-out commits and the lane count the widest row needs. */
export interface GraphLayout {
  readonly rows: readonly GraphRow[]
  readonly lanes: number
}

function freeLane(active: (string | null)[]): number {
  const free = active.indexOf(null)
  return free < 0 ? active.length : free
}

/**
 * Assign lanes to commits listed newest first in topological order.
 * @param commits - commits with their parents' full ids.
 * @returns one row per commit and the widest lane count.
 */
export function layoutGraph(commits: readonly WorkspaceCommit[]): GraphLayout {
  /** Per lane, the commit id its line is heading for, or null for a free lane. */
  const active: (string | null)[] = []
  const rows: GraphRow[] = []
  let lanes = 1
  for (const commit of commits) {
    const arriving = active.flatMap((expected, index) => expected === commit.hash ? [index] : [])
    const fromAbove = arriving.length > 0
    const lane = arriving[0] ?? freeLane(active)
    const converging = arriving.slice(1)
    for (const index of converging) active[index] = null
    active[lane] = null
    const passing = active.flatMap((expected, index) => expected === null ? [] : [index])
    const next: number[] = []
    commit.parents.forEach((parent, order) => {
      let target = order === 0 ? lane : active.indexOf(parent)
      if (target < 0) target = freeLane(active)
      active[target] = parent
      next.push(target)
    })
    lanes = Math.max(lanes, active.length, lane + 1)
    rows.push({ commit, lane, fromAbove, converging, passing, next })
  }
  return { rows, lanes }
}
