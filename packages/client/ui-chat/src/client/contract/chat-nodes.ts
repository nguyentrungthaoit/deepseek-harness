import type {
  AssistantBlock, AssistantMessageNode, CommandNode, CompactionSummaryNode,
  ConversationLocation, ConversationViewNode, ModelRetryNode, RunningToolCall,
  ToolCallBlock,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Final Chat render unit produced by a Chat business Definition. */
export interface ChatConversationViewNode extends ConversationViewNode {
  readonly target: 'chat'
  readonly anchorSeq: number
  readonly location: ConversationLocation
  readonly visibility: 'visible' | 'hidden'
}

/** Merge-extensible payload registry keyed by final Chat renderer kind. */
export interface ChatNodeDataMap {}

/** Renderer kinds contributed by the currently installed Chat business modules. */
export type ChatNodeKind = Extract<keyof ChatNodeDataMap, string>

/** Final Chat Node narrowed to one registered renderer kind and payload. */
export type ChatNode<Kind extends ChatNodeKind = ChatNodeKind> = {
  [RegisteredKind in Kind]: ChatConversationViewNode & {
    readonly kind: RegisteredKind
    readonly data: ChatNodeDataMap[RegisteredKind]
  }
}[Kind]

/** Final Assistant row payload shared by streaming and settled states. */
export interface AssistantChatData {
  readonly status: 'running' | 'settled' | 'interrupted'
  readonly turn: number
  readonly step: number
  readonly blocks: readonly AssistantBlock[]
  readonly time: number
  readonly usage?: unknown
  readonly finalNode?: AssistantMessageNode
}

/** Settled or interrupted Assistant payload with its durable presentation node. */
export type FinalAssistantChatData = AssistantChatData & {
  readonly finalNode: AssistantMessageNode
}

/** Root Tool row payload; the root lifecycle owns all recursive subcalls. */
export interface ToolChatData {
  readonly root: ToolCallBlock
}

/** One manual command and its correlated compaction transaction. */
export interface ManualCompactionChatData {
  readonly command: CommandNode
  readonly compaction: CompactionSummaryNode | null
}

/** One durable retry chain rendered as a single row. */
export interface RetryChatData {
  readonly attempts: readonly ModelRetryNode[]
  readonly current: ModelRetryNode
}

/** One provider/model route that contributed a billed request attempt. */
export interface TurnTokenUsageRoute {
  readonly provider: string
  readonly model: string
}

/** Exact provider-reported token accounting for every attempt in one completed Turn. */
export interface TurnTokenUsage {
  /** Sum of uncached prompt input across all attempts. */
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  /** Exact aggregate prompt plus output total across all attempts. */
  readonly totalTokens: number
  /** Present only when every attempt reported the bucket. */
  readonly cacheReadTokens?: number
  /** Present only when every attempt reported the bucket. */
  readonly cacheWriteTokens?: number
  /** Output subset, present only when every attempt reported it. */
  readonly reasoningTokens?: number
  /** Present only when every billed attempt has provider/model attribution. */
  readonly routes?: readonly TurnTokenUsageRoute[]
}

/** Line totals of one settled file edit, counted as the edit's diff card counts them. */
export interface DiffStat {
  /** File path as the Tool result reports it. */
  readonly path: string
  readonly added: number
  readonly removed: number
}

/** Counts from one recognized test-runner summary; todo cases count as skipped. */
export interface TestTally {
  readonly passed: number
  readonly failed: number
  readonly skipped: number
}

/** End-of-Turn summary derived from the Turn's own lifecycle, Tool-call, and Tool-result events. */
export interface TurnReport {
  /** Milliseconds from `turn/start` to `turn/end`. */
  readonly durationMs: number
  /** Root Tool calls dispatched in the Turn. */
  readonly toolCalls: number
  /** Distinct files with a measured edit. */
  readonly files: number
  /** Lines added across the measured edits. */
  readonly added: number
  /** Lines removed across the measured edits. */
  readonly removed: number
  /** Latest recognized test-runner summary in the Turn's shell output; null when none was recognized. */
  readonly tests: TestTally | null
  /** Longest settled Tool call; null when no call settled with its dispatch in the window. */
  readonly slowest: { readonly name: string; readonly durationMs: number } | null
}

/** Turn-local footer row that owns actions and optional feature contributions. */
export interface TurnTailChatData {
  readonly turn: number
  readonly seq: number
  readonly time: number
  /** Last finalized content-bearing Assistant in this Turn. */
  readonly closing: FinalAssistantChatData | null
  /** Whether non-rendered later evidence makes the closing seq non-tail. */
  readonly branchUnavailable: boolean
  /** Exact per-Turn accounting; absent when the loaded evidence is incomplete. */
  readonly tokenUsage?: TurnTokenUsage
  /** Summary for a Turn whose `turn/start` is loaded and that ran at least the shortest report threshold. */
  readonly report?: TurnReport
}

/** Turn-level process disclosure projected before the finalized answer. */
export interface TurnProcessChatData {
  readonly turn: number
  readonly controlAnchorSeq: number
  readonly processStartSeq: number
  readonly answerAnchorSeq: number | null
  readonly answerStep: number | null
  readonly inlineReasoning: boolean
  readonly messageCount: number
  readonly toolCallCount: number
  readonly subagentCount: number
}

/**
 * Test whether a Tool root has settled.
 * @param block - Tool root lifecycle value.
 * @returns whether the root carries its final result.
 */
export function isSettledTool(block: ToolCallBlock): block is Extract<ToolCallBlock, { kind: 'tool-result' }> {
  return 'kind' in block
}

/**
 * Test whether a Tool root is still running.
 * @param block - Tool root lifecycle value.
 * @returns whether the root lacks a final result.
 */
export function isRunningTool(block: ToolCallBlock): block is RunningToolCall {
  return !isSettledTool(block)
}
