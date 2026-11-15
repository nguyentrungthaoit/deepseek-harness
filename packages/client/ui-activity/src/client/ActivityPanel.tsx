/**
 * Activity tab body: compact meters for the Session's latest Turn above its
 * flame graph. A meter whose source has not reported renders nothing.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { JobsSnapshot, JobView } from '@deepseek-ai/dsh-api-job-controller/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceRepository } from '@deepseek-ai/dsh-workspace-changes/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `contextPressure` projection key merge.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { deriveTurnActivity } from './activity.ts'
import { FlameGraph } from './FlameGraph.tsx'
import { GitGraph } from './GitGraph.tsx'
import { formatCount, formatDuration, type ActivityTranslate } from './format.ts'
import type {} from './locales.ts'
import { SpeedChart } from './SpeedChart.tsx'
import { sampleSteps, speedProfile, type SpeedSample } from './speed.ts'
import css from './ActivityPanel.module.css'

/** Clock period while a Turn runs, in ms. */
const LIVE_TICK_MS = 250

/** Clock period while a Turn runs and the viewer prefers reduced motion, in ms. */
const REDUCED_TICK_MS = 1_000

/** Session sources and callbacks the Activity registration injects. */
export interface ActivityInjected {
  hooks: {
    /** The Session's Chat target; frame-batched by the Conversation assembly. */
    chat: ObservableSnapshot<ChatSnapshot | undefined>
    /** Client background-job rosters keyed by Session. */
    jobs: ObservableSnapshot<JobsSnapshot>
    /** The rolling model speed history across Sessions, oldest first. */
    speed: ObservableSnapshot<readonly SpeedSample[]>
  }
  /**
   * Keep this Session's job roster current while the body is mounted.
   * @returns releases this body's reference.
   */
  watchJobs: () => () => void
  /**
   * Keep these finished-step speed measurements in the rolling history.
   * @param samples - measurements from this Session's loaded steps; already recorded ones are ignored.
   */
  recordSpeed: (samples: readonly SpeedSample[]) => void
  /**
   * Read this Session's repository from the Host.
   * @param signal - cancels the read.
   * @returns the repository, or null when the workspace is not a git repository; rejects when the read fails.
   */
  loadGit: (signal: AbortSignal) => Promise<WorkspaceRepository | null>
  /** Latest runs the speed sparkline draws. */
  speedRecentRuns: number
}

/** The body's composed props. */
export type ActivityPanelProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'activity'>
  & InjectFace<ActivityInjected>

function liveJobs(rows: readonly JobView[] | undefined): number {
  let live = 0
  for (const row of rows ?? []) if (row.status === 'running' || row.status === 'stopping') live++
  return live
}

function selectLegacy(snapshot: ChatSnapshot | undefined): ChatSnapshot['legacy'] | undefined {
  return snapshot === undefined ? undefined : snapshot.legacy
}

function selectTimeline(snapshot: ChatSnapshot | undefined): ChatSnapshot['timeline'] | undefined {
  return snapshot === undefined ? undefined : snapshot.timeline
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Wall clock that advances only while `active`.
 * @param active - whether a visible Turn is running.
 * @returns Unix epoch ms of the latest tick.
 */
function useClock(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, prefersReducedMotion() ? REDUCED_TICK_MS : LIVE_TICK_MS)
    return () => { clearInterval(timer) }
  }, [active])
  return now
}

interface MeterProps {
  readonly label: string
  readonly value: string
  /** Fill share in [0, 1]. */
  readonly ratio: number
}

function Meter({ label, value, ratio }: MeterProps): ReactNode {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  return (
    <div className={css.meter}>
      <div className={css.meterHead}>
        <span className={css.meterLabel}>{label}</span>
        <span className={css.meterValue}>{value}</span>
      </div>
      <div className={css.meterTrack} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={value}>
        <div className={css.meterFill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function percentText(ratio: number, t: ActivityTranslate): string {
  return t('meter.percent', { value: Math.round(ratio * 1000) / 10 })
}

/**
 * The tab body.
 * @param props - tab information, Session projections, the Chat and job sources, and copy.
 * @returns the meters and the latest Turn's flame graph.
 */
export function ActivityPanel(props: ActivityPanelProps): ReactNode {
  const { useChat, useJobs, useSpeed, watchJobs, recordSpeed, loadGit, speedRecentRuns, useProjection, useTabInfo, sessionId, t } = props
  const legacy = useChat(selectLegacy)
  const timeline = useChat(selectTimeline)
  const activity = useMemo(
    () => legacy === undefined || timeline === undefined ? null : deriveTurnActivity({ legacy, timeline }),
    [legacy, timeline],
  )
  const nodes = legacy?.nodes
  const samples = useMemo(() => nodes === undefined ? [] : sampleSteps(sessionId, nodes), [nodes, sessionId])
  useEffect(() => { recordSpeed(samples) }, [samples, recordSpeed])
  const history = useSpeed(snapshot => snapshot)
  const model = samples.at(-1)?.model ?? history.at(-1)?.model
  const profile = useMemo(
    () => model === undefined ? undefined : speedProfile(history, model, speedRecentRuns),
    [history, model, speedRecentRuns],
  )
  // The repository changes when a Turn ends or a Tool call settles.
  const settled = nodes === undefined ? 0 : nodes.filter(node => node.kind === 'tool-result').length
  const gitKey = `${activity?.turn ?? 0}:${activity?.end ?? 'open'}:${settled}`
  const jobs = useJobs(snapshot => liveJobs(snapshot.rows[sessionId]))
  useEffect(() => watchJobs(), [watchJobs])
  const pressure = useProjection('contextPressure')
  const { tab } = useTabInfo()
  const now = useClock(tab.visible && activity !== null && activity.end === null)

  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const limit = pressure?.contextWindow
  return (
    <div className={css.root}>
      <section className={css.meters} aria-label={t('meters.label')}>
        {used !== undefined && limit !== undefined && limit > 0 && (
          <Meter
            label={t('meter.context')}
            value={t('meter.ratio', { used: formatCount(used, t), limit: formatCount(limit, t) })}
            ratio={used / limit}
          />
        )}
        {activity !== null && activity.cacheHit !== null && (
          <Meter label={t('meter.cache')} value={percentText(activity.cacheHit, t)} ratio={activity.cacheHit} />
        )}
        <div className={css.stat}>
          <span className={css.meterLabel}>{t('meter.running')}</span>
          <span className={css.chips}>
            {activity !== null && <span className={css.chip}>{t('running.tools', { count: activity.runningTools })}</span>}
            {activity !== null && <span className={css.chip}>{t('running.subagents', { count: activity.runningSubagents })}</span>}
            <span className={css.chip}>{t('running.jobs', { count: jobs })}</span>
          </span>
        </div>
        {activity !== null && (
          <div className={css.stat}>
            <span className={css.meterLabel}>{t('meter.elapsed')}</span>
            <span className={css.meterValue}>{formatDuration(Math.max(0, (activity.end ?? now) - activity.start), t)}</span>
          </div>
        )}
      </section>
      <GitGraph load={loadGit} refreshKey={gitKey} t={t} />
      {profile !== undefined && <SpeedChart profile={profile} now={Date.now()} t={t} />}
      {activity === null
        ? <p className={css.empty}>{t('timeline.empty')}</p>
        : <FlameGraph activity={activity} now={now} t={t} />}
    </div>
  )
}
