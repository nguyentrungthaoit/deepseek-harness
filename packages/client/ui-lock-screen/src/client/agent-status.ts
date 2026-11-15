/** Summary of every Session's UI status for the lock screen's HUD and status line. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The one Session the status line names, by precedence: waiting, running, done, then idle. */
export type AgentLine =
  | { readonly kind: 'waiting' | 'running' | 'done'; readonly title: string; readonly more: number }
  | { readonly kind: 'idle' }

/** The Session list fields the summary reads; `SessionListState` satisfies it. */
export interface AgentSessionList {
  readonly ids: readonly SessionId[]
  readonly byId: Readonly<Record<SessionId, { readonly displayTitle: string } | undefined>>
}

/** Status facts the summary reads; `SessionStatus` satisfies it. */
export interface AgentStatusFacts {
  readonly running: boolean | undefined
  readonly pendingInteraction: object | undefined
  readonly completionUnread: boolean
}

/** Counts and the headline Session. */
export interface AgentSummary {
  readonly running: number
  readonly waiting: number
  readonly done: number
  readonly line: AgentLine
}

/**
 * Count running, waiting, and finished-unread Sessions and pick the headline.
 * @param list - Session list, for titles and display order.
 * @param status - per-Session running, pending-interaction, and completion facts.
 * @returns the summary.
 */
export function summarizeAgents(list: AgentSessionList, status: ReadonlyMap<SessionId, AgentStatusFacts>): AgentSummary {
  const order = new Map(list.ids.map((id, index) => [id, index]))
  const entries = [...status].sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity))
  const waiting = entries.filter(([, value]) => value.pendingInteraction !== undefined)
  const running = entries.filter(([, value]) => value.running === true && value.pendingInteraction === undefined)
  const done = entries.filter(([, value]) => value.completionUnread && value.running !== true)
  const title = (id: SessionId): string => list.byId[id]?.displayTitle ?? id
  const pick = (kind: 'waiting' | 'running' | 'done', group: typeof entries): AgentLine | undefined => {
    const first = group[0]
    return first === undefined ? undefined : { kind, title: title(first[0]), more: group.length - 1 }
  }
  const line = pick('waiting', waiting) ?? pick('running', running) ?? pick('done', done) ?? { kind: 'idle' as const }
  return { running: running.length + waiting.length, waiting: waiting.length, done: done.length, line }
}
