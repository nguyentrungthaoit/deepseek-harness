/**
 * Fold the Chat snapshot into the latest Turn's timeline spans and live counts.
 *
 * Every time comes from a recorded event: `step/start`, the Assistant's first
 * token and completion, and each Tool call's dispatch and result. A running
 * span has no end; the panel draws it up to the current clock.
 */
import type {
  AssistantBlock, AssistantMessageNode, ChatSnapshot, PartialAssistant, ToolCallBlock,
} from '@deepseek-ai/dsh-client-ui-chat/client'

/** What a span shows: a model phase, or one Tool call. */
export type SpanKind = 'waiting' | 'thinking' | 'writing' | 'tool' | 'subagent'

/** One bar of the flame graph. */
export interface ActivitySpan {
  /** Stable React key. */
  readonly key: string
  readonly kind: SpanKind
  /** Wire Tool name; absent for a model step. */
  readonly name?: string
  /** Agent-loop step number; present for a model step. */
  readonly step?: number
  /** Nesting level: 0 for model steps and root calls, one more per parent call. */
  readonly depth: number
  /** Unix epoch ms when the span began. */
  readonly start: number
  /** Unix epoch ms of the model step's first token, when recorded after `start`. */
  readonly firstToken?: number
  /** Unix epoch ms when the span ended; null while it runs. */
  readonly end: number | null
  /** Whether a Tool call settled with an error. */
  readonly failed: boolean
}

/** The latest Turn folded for the Activity panel. */
export interface TurnActivity {
  readonly turn: number
  /** Unix epoch ms of `turn/start`. */
  readonly start: number
  /** Unix epoch ms of `turn/end`; null while the Turn is open. */
  readonly end: number | null
  /** Spans in start order; each call's descendants follow it. */
  readonly spans: readonly ActivitySpan[]
  /** Dispatched Tool calls still awaiting a result, excluding subagent delegations. */
  readonly runningTools: number
  /** Dispatched subagent delegations still awaiting a result. */
  readonly runningSubagents: number
  /** Share of this Turn's prompt input read from the provider cache; null when no step reported cache reads. */
  readonly cacheHit: number | null
}

/**
 * Recognize the subagent delegation Tool by its shipped name and configured variants.
 * @param name - wire Tool name.
 * @returns whether the call delegates to a subagent.
 */
export function isSubagentCall(name: string): boolean {
  return name === 'subagent' || name.startsWith('subagent_')
}

/**
 * Classify a finished model step by the output it produced.
 * @param blocks - the Assistant's content blocks.
 * @returns `thinking` for reasoning alone, `waiting` for no output, otherwise `writing`.
 */
export function outputKind(blocks: readonly AssistantBlock[]): SpanKind {
  if (blocks.length === 0) return 'waiting'
  return blocks.every(block => block.kind === 'reasoning') ? 'thinking' : 'writing'
}

/**
 * Classify a streaming model step by its newest block.
 * @param partial - in-progress Assistant output.
 * @returns the phase the stream is in now.
 */
export function partialKind(partial: PartialAssistant): SpanKind {
  const last = partial.blocks.at(-1)
  if (last === undefined) return 'waiting'
  return last.kind === 'reasoning' ? 'thinking' : 'writing'
}

function count(usage: object, key: 'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'): number | undefined {
  const value: unknown = Reflect.get(usage, key)
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Cache-hit share over the finished model steps of one Turn.
 * @param nodes - the Turn's finalized Assistant nodes.
 * @returns cache reads divided by uncached input, cache reads, and cache writes; null when no step reported cache reads.
 */
export function turnCacheHit(nodes: readonly AssistantMessageNode[]): number | null {
  let read = 0
  let prompt = 0
  let reported = false
  for (const node of nodes) {
    const usage = node.usage
    if (typeof usage !== 'object' || usage === null) continue
    const input = count(usage, 'inputTokens')
    if (input === undefined) continue
    const cacheRead = count(usage, 'cacheReadTokens')
    if (cacheRead !== undefined) reported = true
    read += cacheRead ?? 0
    prompt += input + (cacheRead ?? 0) + (count(usage, 'cacheWriteTokens') ?? 0)
  }
  return reported && prompt > 0 ? read / prompt : null
}

interface Counts { tools: number; subagents: number }

/** A group is one model step, or one root call followed by its descendants; it is never empty. */
type SpanGroup = readonly [ActivitySpan, ...ActivitySpan[]]

function groupStart(group: SpanGroup): number {
  return group[0].start
}

function addCall(block: ToolCallBlock, depth: number, spans: ActivitySpan[], running: Counts): void {
  let start: number
  let end: number | null
  let failed = false
  if ('kind' in block) {
    if (block.callTime === null) return
    start = block.callTime
    end = block.time
    failed = block.isError
  } else {
    // A preparing call is still model output; its bar starts at dispatch.
    if (block.phase !== 'start') return
    start = block.time
    end = null
  }
  const subagent = isSubagentCall(block.name)
  if (end === null) {
    if (subagent) running.subagents++
    else running.tools++
  }
  spans.push({ key: `call:${block.callId}`, kind: subagent ? 'subagent' : 'tool', name: block.name, depth, start, end, failed })
  for (const child of block.subCalls) addCall(child, depth + 1, spans, running)
}

/**
 * Fold the latest loaded Turn of one Chat snapshot.
 * @param chat - the Session's Chat target snapshot, or undefined before it exists.
 * @returns the Turn's spans and counts, or null when no loaded Turn has a recorded start.
 */
export function deriveTurnActivity(chat: Pick<ChatSnapshot, 'timeline' | 'legacy'> | undefined): TurnActivity | null {
  if (chat === undefined) return null
  const { timeline, legacy } = chat
  let latest: { readonly location: TurnLocation; readonly start: number } | undefined
  for (const turn of timeline.turnOrder) {
    const candidate = timeline.turns.get(turn)
    if (candidate?.start !== undefined) latest = { location: candidate, start: candidate.start.time }
  }
  return latest === undefined ? null : foldTurn(latest.location, latest.start, legacy)
}

type TurnLocation = NonNullable<ReturnType<ChatSnapshot['timeline']['turns']['get']>>

function foldTurn(location: TurnLocation, start: number, legacy: ChatSnapshot['legacy']): TurnActivity {
  const turn = location.turn
  const end = location.end?.time ?? null

  const assistants: AssistantMessageNode[] = []
  const byStep = new Map<number, AssistantMessageNode>()
  for (const node of legacy.nodes) {
    if (node.kind !== 'assistant' || node.turn !== turn) continue
    assistants.push(node)
    byStep.set(node.step, node)
  }
  const runningRoots = legacy.runningCalls.filter(call => call.turn === turn)
  const groups: SpanGroup[] = []
  const running: Counts = { tools: 0, subagents: 0 }

  for (const step of location.steps) {
    const stepStart = step.start?.time
    if (stepStart === undefined) continue
    const base = { key: `step:${step.step}`, step: step.step, depth: 0, start: stepStart, failed: false }
    const node = byStep.get(step.step)
    const partial = legacy.partial
    if (node !== undefined) {
      const firstToken = node.timing?.firstTokenTime ?? null
      groups.push([{
        ...base,
        kind: outputKind(node.blocks),
        ...firstToken !== null && firstToken > stepStart ? { firstToken } : {},
        end: node.timing?.completedTime ?? node.time,
      }])
    } else if (partial !== null && partial.turn === turn && partial.step === step.step) {
      groups.push([{ ...base, kind: partialKind(partial), end: null }])
    } else if (step.end !== undefined) {
      groups.push([{ ...base, kind: 'waiting', end: step.end.time }])
    } else if (!runningRoots.some(call => call.step === step.step)) {
      groups.push([{ ...base, kind: 'waiting', end: null }])
    }
  }

  const roots: ToolCallBlock[] = []
  for (const node of legacy.nodes) {
    if (node.kind !== 'tool-result' || node.parentCallId !== undefined || node.callTime === null) continue
    if (node.callTime < start || (end !== null && node.callTime > end)) continue
    roots.push(node)
  }
  roots.push(...runningRoots)
  for (const root of roots) {
    const spans: ActivitySpan[] = []
    addCall(root, 0, spans, running)
    const [first, ...rest] = spans
    if (first !== undefined) groups.push([first, ...rest])
  }

  groups.sort((left, right) => groupStart(left) - groupStart(right))
  return {
    turn,
    start,
    end,
    spans: groups.flat(),
    runningTools: running.tools,
    runningSubagents: running.subagents,
    cacheHit: turnCacheHit(assistants),
  }
}
