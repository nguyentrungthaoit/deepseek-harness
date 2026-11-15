/** Live details under the running status: Tool-call timeline, edits, tests, streamed output tokens, and the latest reasoning line. */
import { memo, useEffect, useMemo, useState } from 'react'
import type { ChatViewSlotProps, UseChat } from '../contract/slots.ts'
import type { ChatKey } from '../locale.ts'
import { formatTokensPerSecond, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'
import {
  estimateTokens, liveOutcomes, liveToolCalls, reasoningLine, reasoningLineOffset, settledOutput, streamedChars,
  type LiveEdit, type LiveToolCall, type LiveToolStatus,
} from './live-turn.ts'
import { DiffCounts, elapsedLabel, shortPath, TestScoreboard } from './OutcomeBadges.tsx'
import { formatTokens } from './token-format.ts'
import css from './LiveTurnDetails.module.css'

interface LiveTurnDetailsProps {
  /** Unix epoch ms when the running Turn started. */
  readonly startTime: number
  /** Current Unix epoch ms from the running status clock. */
  readonly now: number
  readonly useChat: UseChat
  readonly t: ChatViewSlotProps['t']
}

const STATUS_LABEL: Readonly<Record<LiveToolStatus, ChatKey>> = {
  preparing: 'chat.live.status.preparing',
  running: 'chat.live.status.running',
  done: 'chat.live.status.done',
  failed: 'chat.live.status.failed',
}

function callDuration(call: LiveToolCall, now: number, t: ChatViewSlotProps['t']): string | null {
  return call.start === null ? null : elapsedLabel((call.end ?? now) - call.start, t)
}

const ToolTimeline = memo(function ToolTimeline({ calls, now, t }: {
  calls: readonly LiveToolCall[]
  now: number
  t: ChatViewSlotProps['t']
}) {
  const newestFirst = useMemo(() => [...calls].reverse(), [calls])
  return (
    <ul className={css.tools} aria-label={t('chat.live.tools', { count: calls.length })} data-live-tools>
      {newestFirst.map((call) => {
        const duration = callDuration(call, now, t)
        const status = t(STATUS_LABEL[call.status])
        return (
          <li
            key={call.callId}
            className={css.tool}
            data-status={call.status}
            title={t('chat.live.tool', { name: call.name, status })}
          >
            <span className={css.dot} aria-hidden="true" />
            <span className={css.toolName}>{call.name}</span>
            {duration !== null && <span className={css.toolTime}>{duration}</span>}
          </li>
        )
      })}
    </ul>
  )
})

/** Measured edits, newest first; each new edit slides in at the leading edge. */
const DiffTicker = memo(function DiffTicker({ edits, t }: {
  edits: readonly LiveEdit[]
  t: ChatViewSlotProps['t']
}) {
  return (
    <ul className={css.edits} aria-label={t('chat.diff.edits')} data-live-edits>
      {edits.map(edit => (
        <li
          key={edit.callId}
          className={css.edit}
          title={t('chat.diff.item', { path: edit.path, added: edit.added, removed: edit.removed })}
        >
          <DiffCounts added={edit.added} removed={edit.removed} t={t} />
          <span className={css.editPath}>{shortPath(edit.path)}</span>
        </li>
      ))}
    </ul>
  )
})

/**
 * Show what the running Turn is doing in more detail: the latest reasoning line while
 * the model thinks, one chip per root Tool call with its runtime, and output tokens
 * with the current streaming rate, then the latest test-run counts and a ticker of measured
 * edits. Streamed output is estimated until usage is reported.
 * @param props - Turn start, status clock, Chat snapshot, and localized copy.
 * @returns the details, or null while there is nothing to show.
 */
export const LiveTurnDetails = memo(function LiveTurnDetails({ startTime, now, useChat, t }: LiveTurnDetailsProps) {
  const nodes = useChat(s => s.legacy.nodes)
  const calls = useChat(s => s.legacy.runningCalls)
  const chars = useChat(s => streamedChars(s.legacy.partial))
  const step = useChat(s => s.legacy.partial === null ? '' : `${s.legacy.partial.turn}:${s.legacy.partial.step}`)
  const line = useChat(s => reasoningLine(s.legacy.partial))
  const lineOffset = useChat(s => reasoningLineOffset(s.legacy.partial))
  const tools = useMemo(() => liveToolCalls(nodes, calls, startTime), [nodes, calls, startTime])
  const settled = useMemo(() => settledOutput(nodes, startTime), [nodes, startTime])
  const outcomes = useMemo(() => liveOutcomes(nodes, startTime), [nodes, startTime])
  const streaming = chars > 0
  const [origin, setOrigin] = useState<{ readonly at: number; readonly chars: number } | null>(null)
  // The rate counts only output observed by this page, so a reload mid-stream does not inflate it.
  useEffect(() => { setOrigin(streaming ? { at: Date.now(), chars } : null) }, [step, streaming])

  const output = settled.tokens + estimateTokens(chars)
  const elapsed = origin === null ? 0 : now - origin.at
  const rate = origin !== null && elapsed >= LIVE_RUN_CLOCK_INTERVAL_MS
    ? t('message.tokensPerSecond', { tps: formatTokensPerSecond(estimateTokens(chars - origin.chars) / (elapsed / 1000)) })
    : null
  if (line === '' && tools.length === 0 && output === 0) return null
  const count = formatTokens(output, t)
  return (
    <div className={css.root} data-live-details>
      {line !== '' && (
        <div className={css.reasoning} data-live-reasoning>
          <span key={lineOffset} className={css.reasoningLine}>{line}</span>
        </div>
      )}
      {(tools.length > 0 || output > 0) && (
        <div className={css.meta}>
          {output > 0 && (
            <span className={css.tokens} data-live-tokens>
              {t(settled.estimated || streaming ? 'chat.live.outputEstimated' : 'chat.live.output', { count })}
              {rate !== null && <span className={css.sep} aria-hidden="true">·</span>}
              {rate}
            </span>
          )}
          {tools.length > 0 && <ToolTimeline calls={tools} now={now} t={t} />}
        </div>
      )}
      {(outcomes.tests !== null || outcomes.edits.length > 0) && (
        <div className={css.meta} data-live-outcomes>
          {outcomes.tests !== null && <TestScoreboard tally={outcomes.tests} t={t} />}
          {outcomes.edits.length > 0 && <DiffTicker edits={outcomes.edits} t={t} />}
        </div>
      )}
    </div>
  )
})
