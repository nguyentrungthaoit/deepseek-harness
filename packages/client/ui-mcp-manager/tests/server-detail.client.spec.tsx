// @vitest-environment jsdom
/** Server detail: status, config summary without secrets, tools, actions, and modals. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import type { McpServerConfigView } from '@deepseek-ai/dsh-mcp-manager/types'
import type { McpOutcome } from '../src/client/catalog.ts'
import { ServerDetail } from '../src/client/ServerDetail.tsx'
import { ToolList } from '../src/client/ToolList.tsx'
import { SECRET, t, tool, view } from './fixtures.client.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

const ok: McpOutcome = { kind: 'completed', result: { application: 'applied', warnings: [] } as never }

function mount(server = view(), over: { warnings?: string[]; pending?: boolean; reconnect?: McpOutcome; remove?: McpOutcome } = {}) {
  const h = {
    onBack: vi.fn(), onEdit: vi.fn(),
    onReconnect: vi.fn(async (_orphan: boolean) => over.reconnect ?? ok),
    onRemove: vi.fn(async () => over.remove ?? ok),
  }
  const utils = render(<ServerDetail server={server} warnings={over.warnings ?? []} pending={over.pending ?? false} t={t} {...h} />)
  return { ...utils, ...h }
}

const click = async (el: Element): Promise<void> => { await act(async () => { fireEvent.click(el) }) }

describe('ToolList', () => {
  it('lists tools and the empty line', () => {
    const r = render(<ToolList t={t} tools={[
      tool('a', { title: 'Title', description: 'Desc' }),
      tool('b'),
    ]} />)
    expect(r.getByText('Title')).toBeTruthy()
    expect(r.getByText('Desc')).toBeTruthy()
    cleanup()
    expect(render(<ToolList t={t} tools={[]} />).getByText('No tools')).toBeTruthy()
  })
})

describe('ServerDetail', () => {
  it('shows a failed status with reason, last error, and orphan pid', () => {
    const r = mount(view({ status: { state: 'failed', reason: 'closure-unconfirmed', lastError: 'boom', orphanPid: 42 } }))
    expect(r.getByText('Stopped')).toBeTruthy()
    expect(r.getByText('Could not confirm the previous process stopped')).toBeTruthy()
    expect(r.getByText(/Last error: boom/)).toBeTruthy()
    expect(r.getByText('Process 42 may still be running')).toBeTruthy()
  })

  it('shows backoff attempt and ticks', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const r = mount(view({ status: { state: 'backoff', attempt: 1, maxAttempts: 4, retryAt: 3000, lastError: 'e' } }))
    expect(r.getByText('Attempt 1 of 4')).toBeTruthy()
    expect(r.getByText('Retrying in 3s')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(r.getByText('Retrying in 2s')).toBeTruthy()
  })

  it('summarises stdio config with expressions and never shows secret values', () => {
    // A fresh literal would reject `env`; the variable lets a stray value reach the component.
    const config = {
      serverName: 'files', transport: 'stdio' as const, command: { expression: 'cmd()' }, args: ['-a', '-b'], cwd: '/work',
      env: { TOKEN: SECRET },
    }
    const r = mount(view({
      config,
      secrets: [
        { path: ['env', 'TOKEN'], set: true }, { path: ['env', 'EMPTY'], set: false },
        { path: ['headers', 'X'], set: true }, { path: ['env'], set: true },
      ],
      serverInfo: { name: 'srv', version: '1.0' },
      tools: [tool('read', { description: 'Reads' })],
    }))
    expect(r.getByText('Computed by an expression: cmd()')).toBeTruthy()
    expect(r.getByText('-a -b')).toBeTruthy()
    expect(r.getByText('/work')).toBeTruthy()
    expect(r.getByText('TOKEN')).toBeTruthy()
    expect(r.getByText('EMPTY')).toBeTruthy()
    expect(r.queryByText('X')).toBeNull()
    expect(r.getByText('srv 1.0')).toBeTruthy()
    expect(r.getByText('read')).toBeTruthy()
    expect(r.container.textContent).not.toContain(SECRET)
  })

  it('renders an empty command cell when a malformed row stores none', () => {
    const malformed = { serverName: 'files', transport: 'stdio' as const } as McpServerConfigView
    const r = mount(view({ config: malformed }))
    expect(r.getByText('Command').nextElementSibling?.textContent).toBe('')
  })

  it('summarises http config with headers', () => {
    const r = mount(view({
      transport: 'streamable-http',
      config: { serverName: 'files', transport: 'streamable-http', url: 'https://x/mcp' },
      secrets: [{ path: ['headers', 'Authorization'], set: true }],
    }))
    expect(r.getByText('https://x/mcp')).toBeTruthy()
    expect(r.getByText('Headers')).toBeTruthy()
    expect(r.getByText('Authorization')).toBeTruthy()
  })

  it('shows warnings and read-only notes', () => {
    const r = mount(view({ ownership: 'readonly', readOnlyReason: 'management-required' }), { warnings: ['careful'] })
    expect(r.getByText('careful')).toBeTruthy()
    expect(r.getByText(/Plugin management needs it/)).toBeTruthy()
    expect(r.queryByText('Edit')).toBeNull()
    expect(r.queryByText('Delete')).toBeNull()
    cleanup()
    expect(mount(view({ ownership: 'readonly', readOnlyReason: 'unaddressable' })).getByText(/cannot be identified/)).toBeTruthy()
  })

  it('offers Edit but not Delete for layer rows, with Back and Edit callbacks', () => {
    const r = mount(view({ ownership: 'layer' }))
    expect(r.queryByText('Delete')).toBeNull()
    fireEvent.click(r.getByText('Edit'))
    expect(r.onEdit).toHaveBeenCalled()
    fireEvent.click(r.getByText('Back'))
    expect(r.onBack).toHaveBeenCalled()
  })

  it('disables actions while pending', () => {
    const r = mount(view({ status: { state: 'failed', reason: 'reconnect-disabled' } }), { pending: true })
    expect((r.getByText('Reconnect') as HTMLButtonElement).disabled).toBe(true)
    expect((r.getByText('Edit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('deletes after confirmation, and cancel keeps the row', async () => {
    const r = mount()
    expect((r.getByText('Reconnect') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(r.getByText('Delete'))
    const cancels = within(r.getByRole('dialog')).getAllByText('Cancel')
    fireEvent.click(cancels[cancels.length - 1]!)
    expect(r.onRemove).not.toHaveBeenCalled()
    fireEvent.click(r.getByText('Delete'))
    fireEvent.click(within(r.getByRole('dialog')).getByLabelText('Cancel'))
    expect(r.queryByRole('dialog')).toBeNull()
    fireEvent.click(r.getByText('Delete'))
    await click(within(r.getByRole('dialog')).getByText('Delete'))
    expect(r.onRemove).toHaveBeenCalled()
    expect(r.onBack).toHaveBeenCalled()
  })

  it('keeps the page and shows the error when delete fails', async () => {
    const r = mount(view(), { remove: { kind: 'rejected', errorKey: 'error.readOnly' } })
    fireEvent.click(r.getByText('Delete'))
    await click(within(r.getByRole('dialog')).getByText('Delete'))
    expect(r.onBack).not.toHaveBeenCalled()
    expect(r.getByRole('alert').textContent).toBe('This server is read-only and cannot be changed')
  })

  it('reconnects and reports failures', async () => {
    const failed = view({ status: { state: 'failed', reason: 'attempts-exhausted' } })
    const r = mount(failed, {
      reconnect: { kind: 'completed', result: { application: 'failed', warnings: [], error: { code: 'not-active' } } as never, errorKey: 'error.notActive' },
    })
    await click(r.getByText('Reconnect'))
    expect(r.onReconnect).toHaveBeenCalledWith(false)
    expect(r.getByRole('alert').textContent).toBe('The server cannot reconnect right now')
    cleanup()
    const u = mount(failed, { reconnect: { kind: 'unavailable' } })
    await click(u.getByText('Reconnect'))
    expect(u.getByRole('alert').textContent).toBe('The operation failed. Try again later.')
    cleanup()
    const good = mount(failed)
    await click(good.getByText('Reconnect'))
    expect(good.queryByRole('alert')).toBeNull()
  })

  it('confirms an orphan restart, and cancel closes the modal', async () => {
    const orphan: McpOutcome = {
      kind: 'completed', errorKey: 'error.orphanUnacknowledged',
      result: { application: 'failed', warnings: [], error: { code: 'orphan-unacknowledged', orphanPid: 7 } } as never,
    }
    const r = mount(view({ status: { state: 'failed', reason: 'closure-unconfirmed', orphanPid: 7 } }), { reconnect: orphan })
    await click(r.getByText('Reconnect'))
    let dialog = r.getByRole('dialog')
    expect(within(dialog).getByText(/Process 7 may still be running/)).toBeTruthy()
    const cancels = within(dialog).getAllByText('Cancel')
    fireEvent.click(cancels[cancels.length - 1]!)
    expect(r.queryByRole('dialog')).toBeNull()
    await click(r.getByText('Reconnect'))
    fireEvent.click(within(r.getByRole('dialog')).getByLabelText('Cancel'))
    expect(r.queryByRole('dialog')).toBeNull()
    await click(r.getByText('Reconnect'))
    dialog = r.getByRole('dialog')
    await click(within(dialog).getByText('Restart anyway'))
    expect(r.onReconnect).toHaveBeenLastCalledWith(true)
  })

  it('falls back to pid 0 when the orphan error carries none', async () => {
    const orphan: McpOutcome = {
      kind: 'completed', errorKey: 'error.orphanUnacknowledged',
      result: { application: 'failed', warnings: [], error: { code: 'orphan-unacknowledged' } } as never,
    }
    const r = mount(view({ status: { state: 'failed', reason: 'closure-unconfirmed' } }), { reconnect: orphan })
    await click(r.getByText('Reconnect'))
    expect(within(r.getByRole('dialog')).getByText(/Process 0 may/)).toBeTruthy()
  })
})
