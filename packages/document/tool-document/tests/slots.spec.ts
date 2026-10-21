/** FIFO child slots: concurrency bound, queue bound, abort while waiting, and disposal. */
import { describe, expect, it } from 'vitest'
import { ExtractionSlots } from '../src/slots.ts'

function signal(): AbortSignal {
  return new AbortController().signal
}

describe('ExtractionSlots', () => {
  it('grants up to the slot count, then queues in FIFO order', async () => {
    const slots = new ExtractionSlots(2, 2)
    const first = await slots.acquire(signal())
    const second = await slots.acquire(signal())
    const order: string[] = []
    const third = slots.acquire(signal()).then((release) => { order.push('third'); return release })
    const fourth = slots.acquire(signal()).then((release) => { order.push('fourth'); return release })
    await Promise.resolve()
    expect(order).toEqual([])
    first()
    first()
    const thirdRelease = await third
    expect(order).toEqual(['third'])
    second()
    const fourthRelease = await fourth
    expect(order).toEqual(['third', 'fourth'])
    thirdRelease()
    fourthRelease()
    const again = await slots.acquire(signal())
    again()
  })

  it('rejects at once when the queue is full', async () => {
    const slots = new ExtractionSlots(1, 1)
    const held = await slots.acquire(signal())
    const queued = slots.acquire(signal())
    await expect(slots.acquire(signal())).rejects.toThrow('read_document is busy; retry after the running reads finish')
    held()
    const release = await queued
    release()
  })

  it('removes an aborted waiter from the queue and rejects an already-aborted caller', async () => {
    const slots = new ExtractionSlots(1, 1)
    const held = await slots.acquire(signal())
    const controller = new AbortController()
    const leaving = slots.acquire(controller.signal)
    controller.abort(new Error('caller left'))
    await expect(leaving).rejects.toThrow('caller left')
    const next = slots.acquire(signal())
    held()
    const release = await next
    release()
    await expect(slots.acquire(AbortSignal.abort(new Error('early')))).rejects.toThrow('early')
  })

  it('rejects queued and later acquisitions after dispose', async () => {
    const slots = new ExtractionSlots(1, 2)
    const held = await slots.acquire(signal())
    const controller = new AbortController()
    const queued = slots.acquire(controller.signal)
    slots.dispose()
    await expect(queued).rejects.toThrow('shutting down')
    controller.abort()
    await expect(slots.acquire(signal())).rejects.toThrow('shutting down')
    held()
  })
})
