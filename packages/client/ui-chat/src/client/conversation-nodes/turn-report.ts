/** End-of-Turn report folded from the Turn's own lifecycle, Tool-call, and Tool-result events. */
import type { ConversationMatch } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { TURN_REPORT_CHOICES } from '../../chat-settings.ts'
import type { TestTally, TurnReport } from '../contract/chat-nodes.ts'
import { parseTestTally } from '../test-tally.ts'
import { editDiffStat, isShellTool, resultText } from '../tool-outcome.ts'

/** Turns shorter than every offered threshold never show a card, so their report is not derived. */
const SHORTEST_REPORT_MS = Math.min(...TURN_REPORT_CHOICES.filter(seconds => seconds > 0)) * 1000

interface CallHead {
  readonly name: string
  readonly time: number
  readonly arguments: string
}

/**
 * Derive the report of a completed Turn from its loaded events.
 * @param start - the Turn's `turn/start` match.
 * @param end - the Turn's `turn/end` match.
 * @param matches - every match of the Turn, in log order.
 * @returns the report, or undefined when the Turn ran shorter than the shortest report threshold.
 */
export function turnReport(
  start: ConversationMatch,
  end: ConversationMatch,
  matches: readonly ConversationMatch[],
): TurnReport | undefined {
  const durationMs = end.event.time - start.event.time
  if (durationMs < SHORTEST_REPORT_MS) return undefined
  const calls = new Map<string, CallHead>()
  const results = new Map<string, ConversationMatch>()
  for (const match of matches) {
    const event = match.event
    if (event.type === 'tool/call') {
      calls.set(String(event.data.callId), { name: event.data.name, time: event.time, arguments: event.data.arguments })
    } else if (event.type === 'tool/result') {
      results.set(String(event.data.message.source.callId), match)
    }
  }
  const files = new Set<string>()
  let added = 0
  let removed = 0
  let tests: TestTally | null = null
  let slowest: TurnReport['slowest'] = null
  for (const [callId, match] of results) {
    const call = calls.get(callId)
    const event = match.event
    if (call === undefined || event.type !== 'tool/result') continue
    const ms = event.time - call.time
    if (slowest === null || ms > slowest.durationMs) slowest = { name: call.name, durationMs: ms }
    if (isShellTool(call.name)) {
      tests = parseTestTally(resultText(event.data.message.content)) ?? tests
      continue
    }
    if (event.data.message.isError === true) continue
    const stat = editDiffStat(call.name, PartialArguments.fromText(call.arguments), event.data.meta)
    if (stat === null) continue
    files.add(stat.path)
    added += stat.added
    removed += stat.removed
  }
  return { durationMs, toolCalls: calls.size, files: files.size, added, removed, tests, slowest }
}
