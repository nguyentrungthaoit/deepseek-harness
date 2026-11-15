/** Running Turn clock isolated from the transcript's render cycle. */
import { memo, useEffect, useMemo, useState } from 'react'
import { TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps, UseChat, UseLiveActivity, UseStallWarning } from '../contract/slots.ts'
import { formatRunDuration, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'
import { progressMark, runningActivity, stalledFor, type RunningActivity } from './running-activity.ts'
import { RunningWhaleTail } from './RunningWhaleTail.tsx'
import { LiveTurnDetails } from './LiveTurnDetails.tsx'
import { ReasoningRain } from './ReasoningRain.tsx'
import a11yCss from './accessibility.module.css'
import css from './ChatView.module.css'

interface RunningStatusProps {
  readonly startTime: number | undefined
  readonly useChat: UseChat
  readonly useStallWarning: UseStallWarning
  readonly useLiveActivity: UseLiveActivity
  readonly t: ChatViewSlotProps['t']
}

function duration(ms: number, t: ChatViewSlotProps['t']): string {
  return formatRunDuration(Math.max(1000, ms), t).map(part => part.text).join('')
}

function toolLabel(activity: Extract<RunningActivity, { kind: 'tool' }>, t: ChatViewSlotProps['t']): string {
  return activity.others === 0 ? activity.name : t('chat.activity.toolMore', { name: activity.name, count: activity.others + 1 })
}

function activityLabel(
  activity: RunningActivity,
  lastProgress: number,
  now: number,
  stalled: number | null,
  t: ChatViewSlotProps['t'],
): string {
  switch (activity.kind) {
    case 'waiting':
      return stalled === null
        ? t('chat.activity.waiting', { duration: duration(now - lastProgress, t) })
        : t('chat.stall.model', { duration: duration(stalled, t) })
    case 'thinking':
    case 'writing':
      return stalled === null
        ? t(activity.kind === 'thinking' ? 'chat.activity.thinking' : 'chat.activity.writing')
        : t('chat.stall.output', { duration: duration(stalled, t) })
    case 'tool':
      return stalled === null
        ? t('chat.activity.tool', { name: toolLabel(activity, t), duration: duration(now - activity.since, t) })
        : t('chat.stall.tool', { name: toolLabel(activity, t), duration: duration(stalled, t) })
  }
}

/**
 * Show live elapsed time and the current activity after the current Turn's
 * content, followed, when live details are enabled, by a band of falling reasoning glyphs
 * while the model thinks and the live Turn details. Ticks are not announced;
 * reaching a stall threshold announces once.
 * @param props - Current Turn start time, Chat snapshot, stall thresholds, live-details switch, and localized copy.
 * @returns the blue running indicator; mount only while the Session is running.
 */
export const RunningStatus = memo(function RunningStatus({ startTime, useChat, useStallWarning, useLiveActivity, t }: RunningStatusProps) {
  const [now, setNow] = useState(Date.now)
  const partial = useChat(s => s.legacy.partial)
  const calls = useChat(s => s.legacy.runningCalls)
  const mark = useChat(s => progressMark(s.legacy.partial, s.legacy.runningCalls, s.order.length))
  const thresholds = useStallWarning(value => value)
  const live = useLiveActivity(value => value)
  const [lastProgress, setLastProgress] = useState(Date.now)
  useEffect(() => { setLastProgress(Date.now()) }, [mark])
  useEffect(() => {
    if (startTime === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, LIVE_RUN_CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [startTime])
  const activity = useMemo(() => runningActivity(partial, calls), [partial, calls])
  const stalled = startTime === undefined ? null : stalledFor(activity, lastProgress, now, thresholds)
  const label = startTime === undefined ? t('chat.deepDiving') : t('chat.deepDivingFor', {
    duration: duration(now - startTime, t),
  })
  const announcement = stalled === null ? t('chat.deepDiving') : `${t('chat.deepDiving')} · ${t('chat.stall.announce')}`
  return (
    <div className={css.running} data-chat-running data-stalled={stalled !== null || undefined}>
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      <span className={css.runningDivider} aria-hidden="true" />
      <span className={css.runningContent}>
        <RunningWhaleTail />
        <TextShimmer active className={css.runningText}>{label}</TextShimmer>
        {startTime !== undefined && (
          <span className={css.runningActivity} data-running-activity={activity.kind}>
            {activityLabel(activity, lastProgress, now, stalled, t)}
          </span>
        )}
      </span>
      {startTime !== undefined && live && activity.kind === 'thinking' && <ReasoningRain useChat={useChat} />}
      {startTime !== undefined && live && <LiveTurnDetails startTime={startTime} now={now} useChat={useChat} t={t} />}
    </div>
  )
})
