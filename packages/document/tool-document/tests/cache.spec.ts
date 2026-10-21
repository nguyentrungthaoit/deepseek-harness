/** Extraction cache: LRU bounds, shared running extractions, caller aborts, and disposal. */
import { describe, expect, it } from 'vitest'
import { ExtractionCache } from '../src/cache.ts'
import type { ExtractionOutcome } from '../src/cache.ts'

const LIMITS = { maxEntries: 2, maxBytes: 40 }

function signal(): AbortSignal {
  return new AbortController().signal
}

function done(text: string, cacheable = true): () => Promise<ExtractionOutcome> {
  return () => Promise.resolve({ output: { text }, cacheable })
}

function deferred() {
  const settle = Promise.withResolvers<ExtractionOutcome>()
  const signals: AbortSignal[] = []
  const extract = (shared: AbortSignal): Promise<ExtractionOutcome> => {
    signals.push(shared)
    return settle.promise
  }
  return { extract, signals, resolve: (text: string) => { settle.resolve({ output: { text }, cacheable: true }) }, reject: settle.reject }
}

function failing(): Promise<ExtractionOutcome> {
  throw new Error('a cache hit must not extract')
}

describe('ExtractionCache', () => {
  it('returns a kept result without extracting and does not keep an uncacheable one', async () => {
    const cache = new ExtractionCache(LIMITS)
    expect(await cache.run('a', signal(), done('first'))).toEqual({ text: 'first' })
    expect(await cache.run('a', signal(), failing)).toEqual({ text: 'first' })
    expect(await cache.run('b', signal(), done('changed', false))).toEqual({ text: 'changed' })
    expect(await cache.run('b', signal(), done('again'))).toEqual({ text: 'again' })
  })

  it('does not keep an error', async () => {
    const cache = new ExtractionCache(LIMITS)
    await expect(cache.run('a', signal(), () => Promise.reject(new Error('child failed')))).rejects.toThrow('child failed')
    expect(await cache.run('a', signal(), done('ok'))).toEqual({ text: 'ok' })
  })

  it('evicts the least recently used entry past the entry and byte caps', async () => {
    const cache = new ExtractionCache(LIMITS)
    await cache.run('a', signal(), done('a'))
    await cache.run('b', signal(), done('b'))
    await cache.run('a', signal(), failing)
    await cache.run('c', signal(), done('c'))
    expect(await cache.run('a', signal(), failing)).toEqual({ text: 'a' })
    expect(await cache.run('b', signal(), done('b2'))).toEqual({ text: 'b2' })

    const bytes = new ExtractionCache({ maxEntries: 4, maxBytes: 10 })
    await bytes.run('x', signal(), done('xxx'))
    await bytes.run('y', signal(), done('yyy'))
    expect(await bytes.run('x', signal(), done('x2'))).toEqual({ text: 'x2' })
    await bytes.run('big', signal(), done('123456'))
    expect(await bytes.run('big', signal(), done('again'))).toEqual({ text: 'again' })
    expect(await bytes.run('exact', signal(), done('12345'))).toEqual({ text: '12345' })
    expect(await bytes.run('exact', signal(), failing)).toEqual({ text: '12345' })
  })

  it('shares one running extraction and keeps it alive until every caller aborts', async () => {
    const cache = new ExtractionCache(LIMITS)
    const run = deferred()
    const first = new AbortController()
    const second = new AbortController()
    const a = cache.run('k', first.signal, run.extract)
    const b = cache.run('k', second.signal, failing)
    first.abort(new Error('first left'))
    await expect(a).rejects.toThrow('first left')
    expect(run.signals[0]?.aborted).toBe(false)
    run.resolve('shared')
    expect(await b).toEqual({ text: 'shared' })
    expect(run.signals).toHaveLength(1)
    expect(await cache.run('k', signal(), failing)).toEqual({ text: 'shared' })
  })

  it('aborts the extraction when the last caller aborts and starts a fresh one for a later caller', async () => {
    const cache = new ExtractionCache(LIMITS)
    const stale = deferred()
    const caller = new AbortController()
    const first = cache.run('k', caller.signal, stale.extract)
    caller.abort('gone')
    await expect(first).rejects.toThrow('read_document aborted')
    expect(stale.signals[0]?.aborted).toBe(true)
    const fresh = deferred()
    const second = cache.run('k', signal(), fresh.extract)
    stale.resolve('stale')
    await Promise.resolve()
    fresh.resolve('fresh')
    expect(await second).toEqual({ text: 'fresh' })
    expect(await cache.run('k', signal(), failing)).toEqual({ text: 'fresh' })
  })

  it('rejects a caller whose signal is already aborted without starting an extraction', async () => {
    const cache = new ExtractionCache(LIMITS)
    await expect(cache.run('k', AbortSignal.abort(new Error('early')), failing)).rejects.toThrow('early')
  })

  it('aborts running extractions on dispose, waits for them, and rejects later calls', async () => {
    const cache = new ExtractionCache(LIMITS)
    await cache.run('kept', signal(), done('kept'))
    const run = deferred()
    const caller = new AbortController()
    const pending = cache.run('k', caller.signal, run.extract)
    let disposed = false
    const disposal = cache.dispose().then(() => { disposed = true })
    expect(run.signals[0]?.reason).toEqual(new Error('read_document stopped because the plugin is shutting down'))
    caller.abort(new Error('left during dispose'))
    await expect(pending).rejects.toThrow('left during dispose')
    await Promise.resolve()
    expect(disposed).toBe(false)
    run.resolve('late')
    await disposal
    await expect(cache.run('kept', signal(), failing)).rejects.toThrow('shutting down')
  })

  it('passes a shared extraction failure to every waiting caller', async () => {
    const cache = new ExtractionCache(LIMITS)
    const run = deferred()
    const a = cache.run('k', signal(), run.extract)
    const b = cache.run('k', signal(), failing)
    run.reject(new Error('parse failed'))
    await expect(a).rejects.toThrow('parse failed')
    await expect(b).rejects.toThrow('parse failed')
    await expect(cache.run('s', signal(), async () => { throw 'plain reason' })).rejects.toThrow('plain reason')
  })
})
