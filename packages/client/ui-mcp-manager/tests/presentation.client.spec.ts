/** Status tone, label, ownership, transport, and reconnect mapping. */
import { describe, expect, it } from 'vitest'
import type { McpServerStatus } from '@deepseek-ai/dsh-mcp-manager/types'
import { canReconnect, ownershipKey, statusLabel, statusTone, transportKey } from '../src/client/presentation.ts'

const ALL: McpServerStatus[] = [
  { state: 'disabled' },
  { state: 'not-loaded' },
  { state: 'connecting', attempt: 1 },
  { state: 'connected', since: 0 },
  { state: 'closing' },
  { state: 'backoff', attempt: 2, maxAttempts: 5, retryAt: 10_000 },
  { state: 'failed', reason: 'reconnect-disabled' },
]

describe('statusTone', () => {
  it('maps every state', () => {
    expect(ALL.map(statusTone)).toEqual(['neutral', 'neutral', 'progress', 'success', 'progress', 'warning', 'danger'])
  })
  it('throws on an unknown state', () => {
    expect(() => statusTone({ state: 'bogus' } as never)).toThrow()
  })
})

describe('statusLabel', () => {
  it('labels the simple states', () => {
    expect(statusLabel(ALL[0]!, 0)).toEqual({ key: 'status.disabled' })
    expect(statusLabel(ALL[1]!, 0)).toEqual({ key: 'status.notLoaded' })
    expect(statusLabel(ALL[2]!, 0)).toEqual({ key: 'status.connecting', params: { attempt: 1 } })
    expect(statusLabel(ALL[3]!, 0)).toEqual({ key: 'status.connected' })
    expect(statusLabel(ALL[4]!, 0)).toEqual({ key: 'status.closing' })
  })
  it('rounds the backoff countdown up and clamps at zero', () => {
    const backoff = ALL[5]!
    expect(statusLabel(backoff, 7_500).params).toEqual({ attempt: 2, maxAttempts: 5, seconds: 3 })
    expect(statusLabel(backoff, 10_000).params?.seconds).toBe(0)
    expect(statusLabel(backoff, 20_000).params?.seconds).toBe(0)
  })
  it('names each failure reason as detail', () => {
    const detail = (reason: 'reconnect-disabled' | 'attempts-exhausted' | 'closure-unconfirmed') =>
      statusLabel({ state: 'failed', reason }, 0)
    expect(detail('reconnect-disabled')).toEqual({ key: 'status.failed', detail: { key: 'failure.reconnectDisabled' } })
    expect(detail('attempts-exhausted').detail?.key).toBe('failure.attemptsExhausted')
    expect(detail('closure-unconfirmed').detail?.key).toBe('failure.closureUnconfirmed')
  })
  it('throws on an unknown state or reason', () => {
    expect(() => statusLabel({ state: 'bogus' } as never, 0)).toThrow()
    expect(() => statusLabel({ state: 'failed', reason: 'bogus' } as never, 0)).toThrow()
  })
})

describe('ownershipKey and transportKey', () => {
  it('maps every value', () => {
    expect(['profile', 'layer', 'readonly'].map(o => ownershipKey(o as never)))
      .toEqual(['ownership.profile', 'ownership.layer', 'ownership.readonly'])
    expect(transportKey('stdio')).toBe('transport.stdio')
    expect(transportKey('streamable-http')).toBe('transport.http')
  })
  it('throws on unknown values', () => {
    expect(() => ownershipKey('x' as never)).toThrow()
    expect(() => transportKey('x' as never)).toThrow()
  })
})

describe('canReconnect', () => {
  it('is true for backoff, failed, and not-loaded only', () => {
    expect(ALL.map(canReconnect)).toEqual([false, true, false, false, false, true, true])
  })
})
