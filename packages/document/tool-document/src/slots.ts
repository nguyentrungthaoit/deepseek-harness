/**
 * FIFO admission for `read_document` extractions. At most `maxConcurrent` hold a slot and at most
 * `maxQueued` wait. Waiting is bounded only by the caller's signal and by disposal, never by a deadline.
 * @module @deepseek-ai/dsh-tool-document/slots
 */

import { BUSY_MESSAGE, DISPOSED_MESSAGE, abortError } from './errors.ts'

/** One queued acquisition. */
interface Waiter {
  grant(release: () => void): void
  reject(error: Error): void
}

/** FIFO semaphore owned by one plugin fiber. */
export class ExtractionSlots {
  readonly #maxConcurrent: number
  readonly #maxQueued: number
  readonly #queue: Waiter[] = []
  #running = 0
  #disposed = false

  /**
   * @param maxConcurrent - slots that may be held at once.
   * @param maxQueued - acquisitions that may wait while every slot is held.
   */
  constructor(maxConcurrent: number, maxQueued: number) {
    this.#maxConcurrent = maxConcurrent
    this.#maxQueued = maxQueued
  }

  /**
   * Take a slot, waiting in FIFO order when all are held.
   * Rejects at once with the busy error when the queue is full, with the signal's abort error when the
   * signal aborts before the grant (the waiter leaves the queue), and with the disposal error after {@link dispose}.
   * @param signal - cancels the wait. It has no effect once the slot is granted.
   * @returns an idempotent release that hands the slot to the next waiter.
   */
  acquire(signal: AbortSignal): Promise<() => void> {
    if (this.#disposed) return Promise.reject(new Error(DISPOSED_MESSAGE))
    if (signal.aborted) return Promise.reject(abortError(signal))
    if (this.#running < this.#maxConcurrent) return Promise.resolve(this.#grant())
    if (this.#queue.length >= this.#maxQueued) return Promise.reject(new Error(BUSY_MESSAGE))
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.#queue.indexOf(waiter)
        // Grant and disposal remove the listener as they take the waiter out, so the waiter is still queued here.
        // The guard keeps `splice(-1, 1)` from dropping another waiter if that ever changes.
        /* v8 ignore next -- unreachable while grant and reject detach this listener */
        if (index >= 0) this.#queue.splice(index, 1)
        reject(abortError(signal))
      }
      const waiter: Waiter = {
        grant: (release) => {
          signal.removeEventListener('abort', onAbort)
          resolve(release)
        },
        reject: (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        },
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.#queue.push(waiter)
    })
  }

  /** Reject every queued acquisition and every later one. Held slots stay held until released. */
  dispose(): void {
    this.#disposed = true
    for (const waiter of this.#queue.splice(0)) waiter.reject(new Error(DISPOSED_MESSAGE))
  }

  #grant(): () => void {
    this.#running += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.#running -= 1
      // A queued waiter exists only while every slot is held. Disposal empties the queue.
      this.#queue.shift()?.grant(this.#grant())
    }
  }
}
