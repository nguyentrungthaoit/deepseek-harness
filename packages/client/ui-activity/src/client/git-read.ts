/** The browser's read of the Host-served repository route. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceRepository } from '@deepseek-ai/dsh-workspace-changes/types'
import { activityGitUrl, isRepository } from '../git.ts'

/**
 * Read one Session's repository from the Host.
 * @param sessionId - viewed Session.
 * @param limit - commits requested.
 * @param signal - cancels the request.
 * @returns the repository, or null when the Host reports no repository for the Session.
 * @throws when the request fails or the answer is not a repository.
 */
export async function fetchRepository(sessionId: SessionId, limit: number, signal: AbortSignal): Promise<WorkspaceRepository | null> {
  const response = await fetch(activityGitUrl(sessionId, limit), { signal })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Repository read failed with status ${response.status}.`)
  const value: unknown = await response.json()
  if (!isRepository(value)) throw new Error('Repository answer is malformed.')
  return value
}
