/**
 * Errors shared by the `read_document` parent: caller abort, plugin disposal, and a full queue.
 * @module @deepseek-ai/dsh-tool-document/errors
 */

/** Message of the error queued and shared reads receive when the plugin fiber disposes. */
export const DISPOSED_MESSAGE = 'read_document stopped because the plugin is shutting down'

/** Message returned at once when every child slot and queue place is taken. */
export const BUSY_MESSAGE = 'read_document is busy; retry after the running reads finish'

/**
 * The error a caller receives after its signal aborts.
 * @param signal - the aborted signal.
 * @returns the signal's reason when it is an `Error`, else a generic abort error.
 */
export function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error('read_document aborted')
}
