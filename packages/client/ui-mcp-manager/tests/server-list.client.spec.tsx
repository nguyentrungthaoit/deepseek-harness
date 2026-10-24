// @vitest-environment jsdom
/** Server list rows, load states, backoff countdown, and the enabled switch. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { McpCatalogSnapshot } from '../src/client/catalog.ts'
import { DOT_STATE, ServerList } from '../src/client/ServerList.tsx'
import { entryId, t, tool, view } from './fixtures.client.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

function mount(snapshot: Partial<McpCatalogSnapshot>, canToggle = true) {
  const handlers = { onOpen: vi.fn(), onToggle: vi.fn(), onRetry: vi.fn() }
  const full = { phase: 'ready', servers: [], pending: {}, ...snapshot } as McpCatalogSnapshot
  const utils = render(<ServerList snapshot={full} canToggle={canToggle} t={t} {...handlers} />)
  return { ...utils, ...handlers }
}

const isDisabled = (el: HTMLElement): boolean =>
  (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true'

describe('ServerList', () => {
  it('maps tones to dot states', () => {
    expect(DOT_STATE.danger).toBe('error')
  })

  it('shows loading, failed with retry, and empty', () => {
    const loading = mount({ phase: 'loading' })
    expect(loading.getByText('Reading MCP servers…')).toBeTruthy()
    cleanup()
    const failed = mount({ phase: 'failed', error: 'error.operationError' })
    expect(failed.getByRole('alert').textContent).toBe('Could not read the MCP server list')
    fireEvent.click(failed.getByText('Retry'))
    expect(failed.onRetry).toHaveBeenCalled()
    cleanup()
    expect(mount({}).getByText('No MCP servers configured')).toBeTruthy()
  })

  it('renders each status and opens a row', () => {
    const servers = [
      view({ entryId: entryId('a'), serverName: 'a', status: { state: 'disabled' } }),
      view({ entryId: entryId('b'), serverName: 'b', status: { state: 'connecting', attempt: 2 } }),
      view({ entryId: entryId('c'), serverName: 'c', status: { state: 'failed', reason: 'attempts-exhausted' }, transport: 'streamable-http', ownership: 'layer' }),
      view({ entryId: entryId('d'), serverName: 'd', status: { state: 'connected', since: 0 }, tools: [tool('x')] }),
    ]
    const r = mount({ servers })
    expect(r.getByText('Disabled')).toBeTruthy()
    expect(r.getByText('Connecting')).toBeTruthy()
    expect(r.getByText('Stopped')).toBeTruthy()
    expect(r.getByText('1 tools')).toBeTruthy()
    expect(r.getByText('Streamable HTTP')).toBeTruthy()
    fireEvent.click(r.getByText('c'))
    expect(r.onOpen).toHaveBeenCalledWith('c')
  })

  it('switches enabled and locks it for readonly and pending rows and a missing manager', () => {
    const servers = [
      view({ entryId: entryId('a'), serverName: 'a' }),
      view({ entryId: entryId('b'), serverName: 'b', ownership: 'readonly' }),
      view({ entryId: entryId('c'), serverName: 'c' }),
    ]
    const r = mount({ servers, pending: { c: 'toggling' } })
    const switches = r.getAllByRole('switch')
    expect(switches.map(isDisabled)).toEqual([false, true, true])
    fireEvent.click(switches[0]!)
    expect(r.onToggle).toHaveBeenCalledWith('a', false)
    cleanup()
    const off = mount({ servers: [servers[0]!] }, false)
    expect(isDisabled(off.getByRole('switch'))).toBe(true)
    expect(off.container.querySelector('[title="Plugin management is unavailable"]')).toBeTruthy()
  })

  it('counts down a backoff and stops the interval on unmount', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const server = view({ status: { state: 'backoff', attempt: 1, maxAttempts: 3, retryAt: 1_005_000 } })
    const r = mount({ servers: [server] })
    expect(r.getByText('Retrying in 5s')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(r.getByText('Retrying in 3s')).toBeTruthy()
    r.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
