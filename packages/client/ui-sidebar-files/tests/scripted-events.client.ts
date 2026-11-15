/** Tool-call and tool-result entries shaped like the session's live event window. */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'

/**
 * A `tool/call` entry.
 * @param callId - the call's id.
 * @param name - wire tool name.
 * @param args - arguments object, serialised the way the model produces them.
 * @param time - epoch milliseconds.
 * @returns the entry.
 */
export function toolCall(callId: string, name: string, args: object, time: number): SessionEventLikeEntry {
  return { type: 'event', event: { type: 'tool/call', seq: 1, time, data: { turn: 1, callId, name, arguments: JSON.stringify(args) } } } as never
}

/**
 * A `tool/result` entry.
 * @param callId - the call it settles.
 * @param time - epoch milliseconds.
 * @param extra - `isError` and result `meta`.
 * @param extra.isError - whether the call failed.
 * @param extra.meta - the result's presentation metadata.
 * @returns the entry.
 */
export function toolResult(callId: string, time: number, extra: { isError?: boolean; meta?: object } = {}): SessionEventLikeEntry {
  return {
    type: 'event',
    event: { type: 'tool/result', seq: 2, time, data: { turn: 1, meta: extra.meta, message: { isError: extra.isError, source: { callId } } } },
  } as never
}
