/**
 * Host companion for the Activity tab. The panel lives in the browser export;
 * this half serves the one authenticated read-only route the panel's git graph
 * uses, answered by `workspaceChanges.repository`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-workspace-changes/types'
import { ACTIVITY_GIT_PATH } from './git.ts'

/** Services needed to register the route and read the repository. */
export const inject = ['connection', 'workspaceChanges']

const COUNT = /^\d+$/

async function handleGit(ctx: Context, request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const id = query.get('sessionId')
  const limit = query.get('limit')
  if (!id || limit === null || !COUNT.test(limit) || Number(limit) < 1) return new Response('Invalid repository coordinates.', { status: 400 })
  try {
    const repository = await ctx.workspaceChanges.repository(id as SessionId, Number(limit), request.signal)
    if (repository === undefined) return new Response('No repository for this Session.', { status: 404 })
    return Response.json(repository, { headers: { 'cache-control': 'no-store' } })
  } catch {
    // A failed or timed-out git read is a transient absence; the panel keeps its last answer.
    return new Response('Repository unavailable.', { status: 500 })
  }
}

/**
 * Host plugin body: register the repository read inside Connection's authentication fence.
 * @param ctx - host context with `connection` and `workspaceChanges`.
 */
export function apply(ctx: Context): void {
  ctx.connection.fetch.register({
    path: ACTIVITY_GIT_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: request => handleGit(ctx, request),
  })
}
