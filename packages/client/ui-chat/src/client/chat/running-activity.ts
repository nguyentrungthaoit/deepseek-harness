/** What the running Turn is doing now, and whether it has gone quiet for too long. */
import type { PartialAssistant, RunningToolCall } from '../contract/snapshot.ts'
import type { StallWarningThresholds } from '../stall-warning.ts'

/** Current phase of a running Turn, read from the streaming partial and the running Tool calls. */
export type RunningActivity =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'thinking' }
  | { readonly kind: 'writing' }
  | {
    readonly kind: 'tool'
    /** Name of the longest-running dispatched call. */
    readonly name: string
    /** Unix epoch ms when that call was dispatched. */
    readonly since: number
    /** Further dispatched calls running beside it. */
    readonly others: number
  }

/**
 * Classify the running Turn. A dispatched Tool call wins over model output,
 * and a call whose arguments are still streaming counts as model output.
 * @param partial - in-progress Assistant output, or null between model requests.
 * @param calls - root Tool calls still preparing or awaiting their result.
 * @returns the activity the running status presents.
 */
export function runningActivity(
  partial: PartialAssistant | null,
  calls: readonly RunningToolCall[],
): RunningActivity {
  let oldest: RunningToolCall | undefined
  let started = 0
  for (const call of calls) {
    if (call.phase !== 'start') continue
    started++
    if (oldest === undefined || call.time < oldest.time) oldest = call
  }
  if (oldest !== undefined) return { kind: 'tool', name: oldest.name, since: oldest.time, others: started - 1 }
  const last = partial?.blocks.at(-1)
  if (last === undefined) return calls.length > 0 ? { kind: 'writing' } : { kind: 'waiting' }
  return last.kind === 'reasoning' ? { kind: 'thinking' } : { kind: 'writing' }
}

/**
 * Summarize streamed progress so that any new chunk, Node, or call changes the value.
 * @param partial - in-progress Assistant output, or null between model requests.
 * @param calls - root Tool calls still preparing or awaiting their result.
 * @param nodes - number of ordered Chat Nodes.
 * @returns a comparable progress mark.
 */
export function progressMark(
  partial: PartialAssistant | null,
  calls: readonly RunningToolCall[],
  nodes: number,
): string {
  let streamed = 0
  for (const block of partial?.blocks ?? []) {
    if (block.kind === 'text' || block.kind === 'reasoning') streamed += block.text.length
    else if (block.kind === 'tool-call') streamed += block.argsRaw.length
    else streamed++
  }
  let started = 0
  for (const call of calls) if (call.phase === 'start') started++
  return `${nodes}:${calls.length}:${started}:${streamed}`
}

/**
 * Measure how long the current activity has gone without progress, once past its threshold.
 * A Tool call is measured from its dispatch; model phases from the last observed progress.
 * @param activity - current running activity.
 * @param lastProgress - Unix epoch ms when progress was last observed.
 * @param now - current Unix epoch ms.
 * @param thresholds - accepted warning thresholds in seconds; 0 disables one.
 * @returns elapsed ms when the threshold is reached, otherwise null.
 */
export function stalledFor(
  activity: RunningActivity,
  lastProgress: number,
  now: number,
  thresholds: StallWarningThresholds,
): number | null {
  const tool = activity.kind === 'tool'
  const seconds = tool ? thresholds.tool : thresholds.model
  if (seconds === 0) return null
  const elapsed = Math.max(0, now - (tool ? activity.since : lastProgress))
  return elapsed >= seconds * 1000 ? elapsed : null
}
