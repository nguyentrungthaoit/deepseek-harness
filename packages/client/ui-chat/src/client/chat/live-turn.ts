/** Running-Turn readings for the live details under the running status: Tool calls, edits, tests, output tokens, and reasoning. */
import type { DiffStat, TestTally } from '../contract/chat-nodes.ts'
import type {
  AssistantBlock, ConversationNode, PartialAssistant, RunningToolCall, ToolResultNode,
} from '../contract/snapshot.ts'
import { assistantStepReading } from '../contract/turn-metrics.ts'
import { parseTestTally } from '../test-tally.ts'
import { editDiffStat, isShellTool, resultText } from '../tool-outcome.ts'

/**
 * Characters per token for output that has no provider-reported usage yet.
 * Matches the `dsh-token-meter` estimator so live and Host estimates agree.
 */
export const ESTIMATED_CHARS_PER_TOKEN = 4

/** Presentation state of one root Tool call in the running Turn. */
export type LiveToolStatus = 'preparing' | 'running' | 'done' | 'failed'

/** One root Tool call of the running Turn, in dispatch order. */
export interface LiveToolCall {
  readonly callId: string
  readonly name: string
  readonly status: LiveToolStatus
  /** Unix epoch ms when the call was dispatched; null while preparing or when the call left the loaded window. */
  readonly start: number | null
  /** Unix epoch ms of the result; null while the call has not settled. */
  readonly end: number | null
}

const NO_CALLS: readonly LiveToolCall[] = []

/** Settled Nodes of the Turn that started at `startTime`, newest first; scans only that Turn's tail. */
function turnNodes(nodes: readonly ConversationNode[], startTime: number): readonly ConversationNode[] {
  return nodes.slice(nodes.findLastIndex(node => node.time < startTime) + 1).reverse()
}

/**
 * List the root Tool calls of the running Turn: settled results first, then still-running calls.
 * @param nodes - settled Conversation Nodes in log order.
 * @param calls - root Tool calls still preparing or awaiting their result.
 * @param startTime - Unix epoch ms when the running Turn started.
 * @returns the calls in dispatch order.
 */
export function liveToolCalls(
  nodes: readonly ConversationNode[],
  calls: readonly RunningToolCall[],
  startTime: number,
): readonly LiveToolCall[] {
  const settled: LiveToolCall[] = []
  for (const node of turnNodes(nodes, startTime)) {
    if (node.kind !== 'tool-result' || node.parentCallId !== undefined) continue
    settled.push({
      callId: node.callId,
      name: node.name,
      status: node.isError ? 'failed' : 'done',
      start: node.callTime,
      end: node.time,
    })
  }
  if (settled.length === 0 && calls.length === 0) return NO_CALLS
  settled.reverse()
  for (const call of calls) {
    settled.push(call.phase === 'start'
      ? { callId: call.callId, name: call.name, status: 'running', start: call.time, end: null }
      : { callId: call.callId, name: call.name, status: 'preparing', start: null, end: null })
  }
  return settled
}

function blockChars(blocks: readonly AssistantBlock[]): number {
  let chars = 0
  for (const block of blocks) {
    if (block.kind === 'text' || block.kind === 'reasoning') chars += block.text.length
    else if (block.kind === 'tool-call') chars += block.argsRaw.length
  }
  return chars
}

/**
 * Estimate output tokens from streamed characters.
 * @param chars - streamed text, reasoning, and Tool-argument characters.
 * @returns the estimated token count.
 */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / ESTIMATED_CHARS_PER_TOKEN)
}

/**
 * Count characters streamed so far in the current model request.
 * @param partial - in-progress Assistant output, or null between model requests.
 * @returns text, reasoning, and Tool-argument characters.
 */
export function streamedChars(partial: PartialAssistant | null): number {
  return partial === null ? 0 : blockChars(partial.blocks)
}

/** Output tokens of the running Turn's settled model requests. */
export interface SettledOutput {
  readonly tokens: number
  /** Whether any settled request lacked provider-reported usage and was estimated. */
  readonly estimated: boolean
}

/**
 * Sum output tokens of the running Turn's settled Assistant messages, preferring reported usage.
 * @param nodes - settled Conversation Nodes in log order.
 * @param startTime - Unix epoch ms when the running Turn started.
 * @returns the total and whether part of it is estimated.
 */
export function settledOutput(nodes: readonly ConversationNode[], startTime: number): SettledOutput {
  let tokens = 0
  let estimated = false
  for (const node of turnNodes(nodes, startTime)) {
    if (node.kind !== 'assistant') continue
    const reported = assistantStepReading(node).outputTokens
    if (reported !== null) tokens += reported
    else {
      tokens += estimateTokens(blockChars(node.blocks))
      estimated = true
    }
  }
  return { tokens, estimated }
}

function latestLine(partial: PartialAssistant | null): { readonly text: string; readonly offset: number } | null {
  const last = partial?.blocks.at(-1)
  if (last?.kind !== 'reasoning') return null
  const text = last.text.trimEnd()
  const offset = text.lastIndexOf('\n') + 1
  const line = text.slice(offset).trim()
  return line === '' ? null : { text: line, offset }
}

/**
 * Read the latest non-empty reasoning line while the model is thinking.
 * @param partial - in-progress Assistant output, or null between model requests.
 * @returns the line, or an empty string when the model is not thinking.
 */
export function reasoningLine(partial: PartialAssistant | null): string {
  return latestLine(partial)?.text ?? ''
}

/**
 * Locate the latest reasoning line so that a view can restart its fade only when a new line begins.
 * @param partial - in-progress Assistant output, or null between model requests.
 * @returns the line's character offset in its reasoning block, or -1 when there is none.
 */
export function reasoningLineOffset(partial: PartialAssistant | null): number {
  return latestLine(partial)?.offset ?? -1
}

/** One measured edit of the running Turn. */
export interface LiveEdit extends DiffStat {
  readonly callId: string
}

/** Measured outcomes of the running Turn's settled root Tool calls. */
export interface LiveOutcomes {
  /** Measured edits, newest first. */
  readonly edits: readonly LiveEdit[]
  /** Latest recognized test-runner summary; null when none was recognized. */
  readonly tests: TestTally | null
}

const NO_OUTCOMES: LiveOutcomes = { edits: [], tests: null }
// Settled results never change, so each is measured once however often the Turn re-renders.
const measuredEdits = new WeakMap<ToolResultNode, LiveEdit | null>()
const measuredTallies = new WeakMap<ToolResultNode, TestTally | null>()

function measuredEdit(node: ToolResultNode): LiveEdit | null {
  let edit = measuredEdits.get(node)
  if (edit === undefined) {
    const stat = node.isError ? null : editDiffStat(node.name, node.args, node.meta)
    edit = stat === null ? null : { ...stat, callId: node.callId }
    measuredEdits.set(node, edit)
  }
  return edit
}

function measuredTally(node: ToolResultNode): TestTally | null {
  let tally = measuredTallies.get(node)
  if (tally === undefined) {
    tally = parseTestTally(resultText(node.content))
    measuredTallies.set(node, tally)
  }
  return tally
}

/**
 * Collect the measured edits and the latest test-runner summary of the running Turn's settled root calls.
 * @param nodes - settled Conversation Nodes in log order.
 * @param startTime - Unix epoch ms when the running Turn started.
 * @returns the outcomes; one shared empty value when there are none.
 */
export function liveOutcomes(nodes: readonly ConversationNode[], startTime: number): LiveOutcomes {
  const edits: LiveEdit[] = []
  let tests: TestTally | null = null
  for (const node of turnNodes(nodes, startTime)) {
    if (node.kind !== 'tool-result' || node.parentCallId !== undefined) continue
    if (isShellTool(node.name)) tests ??= measuredTally(node)
    else {
      const edit = measuredEdit(node)
      if (edit !== null) edits.push(edit)
    }
  }
  return edits.length === 0 && tests === null ? NO_OUTCOMES : { edits, tests }
}
