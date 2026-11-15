/** Coarse per-Session attention state derived from the unified Session status. */
import type { SessionStatus } from './index.ts'

/** Attention state of one Session, ordered by `SESSION_ACTIVITY_RANK`. */
export type SessionAttention = 'waiting' | 'running' | 'unread' | 'idle'

/** Display order: the Session needing the user comes first, an idle one last. */
export const SESSION_ACTIVITY_RANK: Readonly<Record<SessionAttention, number>> = {
  waiting: 0,
  running: 1,
  unread: 2,
  idle: 3,
}

/**
 * Classify one Session from its observed status facts only.
 * @param status - Session status, absent for a Session the controller has not reported.
 * @returns `waiting` while an approval or question is pending, else `running`, `unread` for an
 * unacknowledged completion, otherwise `idle`.
 */
export function sessionActivity(status: SessionStatus | undefined): SessionAttention {
  if (status === undefined) return 'idle'
  if (status.pendingInteraction !== undefined) return 'waiting'
  if (status.running === true) return 'running'
  if (status.completionUnread) return 'unread'
  return 'idle'
}
