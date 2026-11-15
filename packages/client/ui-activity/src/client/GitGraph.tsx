/**
 * The workspace's git mini graph: the latest commits as dots on lanes with
 * their short hash, subject, and age, above a line counting the uncommitted
 * changes. It renders nothing until the Host answers, and nothing when the
 * workspace is not a git repository.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { WorkspaceRepository } from '@deepseek-ai/dsh-workspace-changes/types'
import { formatAgo, type ActivityTranslate } from './format.ts'
import { layoutGraph, type GraphRow } from './git-graph.ts'
import css from './ActivityPanel.module.css'

/** Width of one lane, in px. */
const LANE_WIDTH = 12

/** Height of one commit row, in px. */
const ROW_HEIGHT = 24

/** Dot radius, in px. */
const DOT_RADIUS = 3.5

/** Hash characters shown, the git default abbreviation. */
const SHORT_HASH = 7

/** Lane colors cycle through this many classes. */
const LANE_COLORS = 4

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2
}

function laneClass(lane: number): string | undefined {
  return css[`lane${lane % LANE_COLORS}`]
}

interface GraphCellProps {
  readonly row: GraphRow
  readonly lanes: number
}

function GraphCell({ row, lanes }: GraphCellProps): ReactNode {
  const middle = ROW_HEIGHT / 2
  const x = laneX(row.lane)
  return (
    <svg className={css.graphCell} width={lanes * LANE_WIDTH} height={ROW_HEIGHT} aria-hidden>
      {row.passing.map(lane => (
        <line key={`through-${lane}`} className={laneClass(lane)} x1={laneX(lane)} y1={0} x2={laneX(lane)} y2={ROW_HEIGHT} />
      ))}
      {row.fromAbove && <line className={laneClass(row.lane)} x1={x} y1={0} x2={x} y2={middle} />}
      {row.converging.map(lane => (
        <line key={`join-${lane}`} className={laneClass(lane)} x1={laneX(lane)} y1={0} x2={x} y2={middle} />
      ))}
      {row.next.map(lane => (
        <line key={`parent-${lane}`} className={laneClass(lane)} x1={x} y1={middle} x2={laneX(lane)} y2={ROW_HEIGHT} />
      ))}
      <circle className={laneClass(row.lane)} cx={x} cy={middle} r={DOT_RADIUS} />
    </svg>
  )
}

/** Props of the git graph. */
export interface GitGraphProps {
  /**
   * Read the repository from the Host.
   * @param signal - cancels the read when a newer one starts or the graph unmounts.
   * @returns the repository, or null when the workspace is not a git repository; rejects on a failed read.
   */
  readonly load: (signal: AbortSignal) => Promise<WorkspaceRepository | null>
  /** Changes whenever the repository may have changed; each change starts a read. */
  readonly refreshKey: string
  readonly t: ActivityTranslate
}

interface Loaded {
  readonly repository: WorkspaceRepository | null
  /** Clock of the read, used to age the commits. */
  readonly at: number
}

function changesText(repository: WorkspaceRepository, t: ActivityTranslate): string {
  if (repository.files === 0) return t('git.clean')
  return t(repository.files === 1 ? 'git.changes.one' : 'git.changes.other', {
    files: repository.files, added: repository.added, deleted: repository.deleted,
  })
}

/**
 * Draw the repository section.
 * @param props - the Host read, the refresh key, and copy.
 * @returns the section, or null while unknown or outside a repository.
 */
export function GitGraph({ load, refreshKey, t }: GitGraphProps): ReactNode {
  const [loaded, setLoaded] = useState<Loaded>()
  useEffect(() => {
    const read = new AbortController()
    void load(read.signal).then(
      (repository) => { if (!read.signal.aborted) setLoaded({ repository, at: Date.now() }) },
      // A failed read keeps the last answer; the next refresh retries.
      () => undefined,
    )
    return () => { read.abort() }
  }, [load, refreshKey])
  const repository = loaded?.repository ?? null
  const layout = useMemo(() => layoutGraph(repository?.commits ?? []), [repository])
  if (loaded === undefined || repository === null) return null
  return (
    <section className={css.git} aria-label={t('git.label')}>
      <header className={css.sectionHead}>
        <h3 className={css.heading}>{t('git.heading')}</h3>
        <span className={css.status}>{repository.branch ?? t(repository.commits.length === 0 ? 'git.noCommits' : 'git.detached')}</span>
      </header>
      <p className={css.gitChanges}>{changesText(repository, t)}</p>
      <ol className={css.commits}>
        {layout.rows.map(row => (
          <li key={row.commit.hash} className={css.commit}>
            <GraphCell row={row} lanes={layout.lanes} />
            <span className={css.hash}>{row.commit.hash.slice(0, SHORT_HASH)}</span>
            <span className={css.subject} title={row.commit.subject}>{row.commit.subject}</span>
            <span className={css.age}>{formatAgo(loaded.at - row.commit.time, t)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
