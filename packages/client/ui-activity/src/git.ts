/** Route, request address, and response validation for the workspace repository read the Activity tab shows. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceCommit, WorkspaceRepository } from '@deepseek-ai/dsh-workspace-changes/types'

/** Authenticated GET route serving the latest commits and uncommitted change counts of one Session's repository. */
export const ACTIVITY_GIT_PATH = '/api/activity.git'

/** Browser-relative form of {@link ACTIVITY_GIT_PATH}. */
export const ACTIVITY_GIT_ROUTE = ACTIVITY_GIT_PATH.slice(1)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCommit(value: unknown): value is WorkspaceCommit {
  if (!isRecord(value)) return false
  const { hash, parents, time, subject } = value
  return typeof hash === 'string' && hash.length > 0 && typeof subject === 'string' && Number.isFinite(time)
    && Array.isArray(parents) && parents.every(parent => typeof parent === 'string' && parent.length > 0)
}

/**
 * Validate a repository read from the route.
 * @param value - decoded JSON.
 * @returns whether the value carries a branch, well-formed commits, and the change counts.
 */
export function isRepository(value: unknown): value is WorkspaceRepository {
  if (!isRecord(value)) return false
  const { branch, commits, files, added, deleted } = value
  return (branch === null || typeof branch === 'string')
    && [files, added, deleted].every(count => Number.isSafeInteger(count) && (count as number) >= 0)
    && Array.isArray(commits) && commits.every(isCommit)
}

/**
 * Build the document-relative address of one repository read.
 * @param sessionId - viewed Session.
 * @param limit - commits requested.
 * @returns route with its query.
 */
export function activityGitUrl(sessionId: SessionId, limit: number): string {
  return `${ACTIVITY_GIT_ROUTE}?${new URLSearchParams({ sessionId, limit: String(limit) })}`
}
