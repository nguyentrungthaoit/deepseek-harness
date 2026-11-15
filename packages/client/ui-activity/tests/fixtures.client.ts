/** Hand-built Chat snapshot slices for the Activity fold and panel specs. */
import type {
  AssistantBlock, AssistantMessageNode, ChatSnapshot, ConversationNode, PartialAssistant, RunningToolCall,
  ToolCallBlock, ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'

type Timeline = ChatSnapshot['timeline']
type TurnLocation = NonNullable<ReturnType<Timeline['turns']['get']>>
type StepLocation = TurnLocation['steps'][number]

/** The fold's input: the Chat timeline and the compatibility slice. */
export type ChatInput = Pick<ChatSnapshot, 'timeline' | 'legacy'>

/** One step as the timeline records it. */
export interface StepSpec {
  readonly step: number
  readonly start?: number
  readonly end?: number
}

/** One Turn as the timeline records it. */
export interface TurnSpec {
  readonly turn: number
  readonly start?: number
  readonly end?: number
  readonly steps?: readonly StepSpec[]
}

function stepLocation(turn: number, spec: StepSpec): StepLocation {
  return {
    turn,
    step: spec.step,
    start: spec.start === undefined ? undefined : { time: spec.start },
    end: spec.end === undefined ? undefined : { time: spec.end },
    status: spec.end === undefined ? 'open' : 'closed',
    data: {} as StepLocation['data'],
  } as StepLocation
}

/**
 * Build a timeline whose order lists every Turn, plus extra unknown Turn numbers.
 * @param turns - recorded Turns.
 * @param missing - Turn numbers in the order with no Location.
 * @returns the timeline.
 */
export function timeline(turns: readonly TurnSpec[], missing: readonly number[] = []): Timeline {
  const map = new Map<number, TurnLocation>()
  for (const spec of turns) {
    map.set(spec.turn, {
      turn: spec.turn,
      start: spec.start === undefined ? undefined : { time: spec.start },
      end: spec.end === undefined ? undefined : { time: spec.end },
      status: spec.end === undefined ? 'open' : 'closed',
      steps: (spec.steps ?? []).map(step => stepLocation(spec.turn, step)),
      data: {} as TurnLocation['data'],
    } as TurnLocation)
  }
  return { turnOrder: [...turns.map(spec => spec.turn), ...missing], turns: map }
}

/**
 * Build the fold input.
 * @param turns - recorded Turns.
 * @param slice - finalized nodes, running calls, and the streaming partial.
 * @returns the Chat input.
 */
export function chat(
  turns: readonly TurnSpec[],
  slice: {
    nodes?: readonly ConversationNode[]
    runningCalls?: readonly RunningToolCall[]
    partial?: PartialAssistant | null
    missing?: readonly number[]
  } = {},
): ChatInput {
  return {
    timeline: timeline(turns, slice.missing),
    legacy: {
      nodes: slice.nodes ?? [],
      turnTimings: new Map(),
      turnEnds: new Map(),
      partial: slice.partial ?? null,
      runningCalls: slice.runningCalls ?? [],
    },
  }
}

/**
 * A finalized Assistant node.
 * @param fields - turn, step, completion, and optional timing, usage, and blocks.
 * @returns the node.
 */
export function assistant(fields: {
  turn: number
  step: number
  time: number
  blocks?: readonly AssistantBlock[]
  usage?: unknown
  timing?: AssistantMessageNode['timing']
  /** Provider-reported model name. */
  model?: string
  interrupted?: true
}): AssistantMessageNode {
  return {
    kind: 'assistant',
    seq: fields.time,
    turn: fields.turn,
    step: fields.step,
    time: fields.time,
    blocks: fields.blocks ?? [{ kind: 'text', text: 'done' }],
    ...fields.usage === undefined ? {} : { usage: fields.usage },
    ...fields.timing === undefined ? {} : { timing: fields.timing },
    ...fields.model === undefined ? {} : { providerMetadata: { provider: 'p', model: fields.model } },
    ...fields.interrupted === undefined ? {} : { interrupted: true as const },
  }
}

/**
 * A settled Tool call.
 * @param fields - identity, name, dispatch and result times, failure, and children.
 * @returns the result node.
 */
export function result(fields: {
  callId: string
  name: string
  callTime: number | null
  time: number
  isError?: boolean
  parentCallId?: string
  subCalls?: readonly ToolCallBlock[]
}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: fields.time,
    time: fields.time,
    callId: fields.callId,
    ...fields.parentCallId === undefined ? {} : { parentCallId: fields.parentCallId },
    name: fields.name,
    args: {} as ToolResultNode['args'],
    call: null,
    callTime: fields.callTime,
    content: [],
    isError: fields.isError ?? false,
    subCalls: fields.subCalls ?? [],
  }
}

/**
 * A running Tool call.
 * @param fields - identity, placement, phase, stage start, and children.
 * @returns the running call.
 */
export function running(fields: {
  callId: string
  name: string
  turn: number
  step: number
  time: number
  phase?: 'preparing' | 'start'
  subCalls?: readonly ToolCallBlock[]
}): RunningToolCall {
  const head = {
    callId: fields.callId,
    name: fields.name,
    turn: fields.turn,
    step: fields.step,
    time: fields.time,
    subCalls: fields.subCalls ?? [],
    args: {} as RunningToolCall['args'],
  }
  return fields.phase === 'preparing' ? { ...head, phase: 'preparing' } : { ...head, phase: 'start', argsRaw: '{}' }
}
