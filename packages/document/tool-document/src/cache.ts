/**
 * Extraction results shared by every session of one `read_document` instance.
 * Finished results live in a small LRU. A key that is still extracting is shared: later callers join the
 * running extraction instead of spawning another child. Callers must resolve and stat the path themselves
 * before they build a key, so a session that cannot see a file never reaches this cache.
 * @module @deepseek-ai/dsh-tool-document/cache
 */

import { DISPOSED_MESSAGE, abortError } from './errors.ts'
import type { ChildOutput } from './extract.ts'

/** Cache bounds. */
export interface ExtractionCacheLimits {
  /** Maximum finished results kept. */
  maxEntries: number
  /** Maximum total UTF-16 bytes (`text.length * 2`) of kept results. A larger single result is not kept. */
  maxBytes: number
}

/** What one extraction produced, and whether the file was unchanged while it ran. */
export interface ExtractionOutcome {
  /** The child's result, returned to every caller that is still waiting. */
  output: ChildOutput
  /** False when the file changed between the first stat and the end of extraction. */
  cacheable: boolean
}

/** One running extraction and the callers waiting for it. */
interface SharedExtraction {
  controller: AbortController
  waiters: number
  promise: Promise<ChildOutput>
}

/** LRU of finished extractions plus the extractions still running. */
export class ExtractionCache {
  readonly #limits: ExtractionCacheLimits
  readonly #entries = new Map<string, ChildOutput>()
  readonly #running = new Map<string, SharedExtraction>()
  #bytes = 0
  #disposed = false

  /** @param limits - entry and byte bounds for finished results. */
  constructor(limits: ExtractionCacheLimits) {
    this.#limits = limits
  }

  /**
   * Return the cached result for `key`, join the running extraction for `key`, or start one.
   * A started extraction gets its own signal. It aborts only when every waiting caller has aborted or on
   * {@link dispose}. A caller whose signal aborts rejects with its own abort error; the others keep waiting.
   * Errors are never cached. A result is kept only when `extract` reports it cacheable and the cache is live.
   * @param key - identifies the file contents, for example the resolved path with its version and size.
   * @param signal - this caller's cancellation.
   * @param extract - runs one extraction under the shared signal.
   * @returns the result for this caller.
   */
  run(key: string, signal: AbortSignal, extract: (signal: AbortSignal) => Promise<ExtractionOutcome>): Promise<ChildOutput> {
    if (this.#disposed) return Promise.reject(new Error(DISPOSED_MESSAGE))
    if (signal.aborted) return Promise.reject(abortError(signal))
    const hit = this.#entries.get(key)
    if (hit !== undefined) {
      this.#entries.delete(key)
      this.#entries.set(key, hit)
      return Promise.resolve(hit)
    }
    return this.#join(key, this.#running.get(key) ?? this.#start(key, extract), signal)
  }

  /**
   * Abort every running extraction, wait until each settles, then drop every cached result.
   * Later {@link run} calls reject with the disposal error.
   * @returns a promise that settles after the running extractions have settled.
   */
  async dispose(): Promise<void> {
    this.#disposed = true
    const running = [...this.#running.values()]
    this.#running.clear()
    for (const shared of running) shared.controller.abort(new Error(DISPOSED_MESSAGE))
    await Promise.allSettled(running.map(shared => shared.promise))
    this.#entries.clear()
    this.#bytes = 0
  }

  #start(key: string, extract: (signal: AbortSignal) => Promise<ExtractionOutcome>): SharedExtraction {
    const controller = new AbortController()
    const promise = extract(controller.signal).then((outcome) => {
      if (outcome.cacheable) this.#store(key, outcome.output)
      return outcome.output
    })
    const shared: SharedExtraction = { controller, waiters: 0, promise }
    this.#running.set(key, shared)
    const settle = (): void => {
      // The key may already belong to a newer extraction after every caller of this one aborted.
      if (this.#running.get(key) === shared) this.#running.delete(key)
    }
    promise.then(settle, settle)
    return shared
  }

  #join(key: string, shared: SharedExtraction, signal: AbortSignal): Promise<ChildOutput> {
    shared.waiters += 1
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        shared.waiters -= 1
        if (shared.waiters === 0) {
          if (this.#running.get(key) === shared) this.#running.delete(key)
          shared.controller.abort(abortError(signal))
        }
        reject(abortError(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      shared.promise.then((output) => {
        signal.removeEventListener('abort', onAbort)
        resolve(output)
      }, (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  #store(key: string, output: ChildOutput): void {
    const bytes = output.text.length * 2
    if (this.#disposed || bytes > this.#limits.maxBytes) return
    const previous = this.#entries.get(key)
    if (previous !== undefined) this.#bytes -= previous.text.length * 2
    this.#entries.delete(key)
    this.#entries.set(key, output)
    this.#bytes += bytes
    for (const [oldest, entry] of this.#entries) {
      if (this.#entries.size <= this.#limits.maxEntries && this.#bytes <= this.#limits.maxBytes) break
      this.#entries.delete(oldest)
      this.#bytes -= entry.text.length * 2
    }
  }
}
