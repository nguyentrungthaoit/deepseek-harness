// @vitest-environment jsdom
/** MCP panel: navigation between list, server, create, and edit, and the save flow. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { McpCatalogSnapshot, McpOutcome } from '../src/client/catalog.ts'
import { McpPanel, type McpPanelProps } from '../src/client/McpPanel.tsx'
import { McpPanelIcon } from '../src/client/McpPanelIcon.tsx'
import { createNavigationStore } from '../src/client/navigation-store.ts'
import { t, view } from './fixtures.client.ts'

afterEach(cleanup)

function hook<T>(store: SnapshotStore<T>) {
  return function useStore<S>(select: (state: T) => S): S {
    return select(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot()))
  }
}

const done = (entryId?: string): McpOutcome => ({
  kind: 'completed', result: { ...entryId === undefined ? {} : { entryId }, application: 'applied', warnings: [] } as never,
})

function mount(over: { snapshot?: Partial<McpCatalogSnapshot>; create?: McpOutcome; update?: McpOutcome } = {}) {
  const catalog = createSnapshotStore<McpCatalogSnapshot>({
    phase: 'ready', servers: [view()], pending: {}, ...over.snapshot,
  })
  const nav = createNavigationStore().create()
  const actions = nav.actions
  const fns = {
    refresh: vi.fn(async () => {}),
    create: vi.fn(async () => over.create ?? done('e2')),
    update: vi.fn(async () => over.update ?? done()),
    remove: vi.fn(async () => done()),
    reconnect: vi.fn(async () => done()),
    setEnabled: vi.fn(async () => done()),
  }
  const props: Pick<McpPanelProps, 'canToggle' | 'useCatalog' | 'useStore' | 'actions' | 't' | keyof typeof fns> = {
    t, canToggle: true, useCatalog: hook(catalog), useStore: hook(nav.store), actions, ...fns,
  }
  const utils = render(<McpPanel {...props as McpPanelProps} />)
  return { ...utils, ...fns, nav, catalog }
}

const click = async (el: Element): Promise<void> => { await act(async () => { fireEvent.click(el) }) }
const fillCreate = (r: ReturnType<typeof mount>): void => {
  fireEvent.change(r.getByLabelText('Server name'), { target: { value: 'new' } })
  fireEvent.change(r.getByLabelText('Command'), { target: { value: 'node' } })
}

describe('McpPanel', () => {
  it('renders the icon', () => {
    expect(render(<>{McpPanelIcon({ size: 16 } as never)}</>).container.querySelector('svg')).toBeTruthy()
  })

  it('refreshes on mount, shows the header only on the list, and toggles through the face', async () => {
    const r = mount()
    expect(r.refresh).toHaveBeenCalled()
    expect(r.getByText('MCP servers')).toBeTruthy()
    await click(r.getByRole('switch'))
    expect(r.setEnabled).toHaveBeenCalledWith('e1', false)
    await click(r.getByText('files'))
    expect(r.nav.getSnapshot().view).toEqual({ kind: 'server', entryId: 'e1' })
    expect(r.queryByText('MCP servers')).toBeNull()
  })

  it('retries the list from the failed state', async () => {
    const r = mount({ snapshot: { phase: 'failed', servers: [], error: 'error.operationError' } })
    r.refresh.mockClear()
    await click(r.getByText('Retry'))
    expect(r.refresh).toHaveBeenCalledTimes(1)
  })

  it('shows loading and not-found for an unknown entry, with a way back', async () => {
    const r = mount({ snapshot: { phase: 'loading', servers: [] } })
    act(() => { r.nav.actions.openServer('zz') })
    expect(r.getByText('Reading MCP servers…')).toBeTruthy()
    act(() => { r.catalog.set({ ...r.catalog.getSnapshot(), phase: 'ready' }) })
    expect(r.getByText('MCP server not found')).toBeTruthy()
    await click(r.getByText('Back'))
    expect(r.nav.getSnapshot().view).toEqual({ kind: 'list' })
  })

  it('passes warnings of the last result to the matching detail, reconnects with and without orphan', async () => {
    const r = mount({ snapshot: {
      servers: [view({ status: { state: 'failed', reason: 'attempts-exhausted' } })],
      lastResult: { entryId: 'e1', application: 'applied', warnings: ['heads up'] },
    } })
    act(() => { r.nav.actions.openServer('e1') })
    expect(r.getByText('heads up')).toBeTruthy()
    await click(r.getByText('Reconnect'))
    expect(r.reconnect).toHaveBeenCalledWith('e1', undefined)
    await click(r.getByText('Delete'))
    await click(r.getAllByText('Delete').at(-1)!)
    expect(r.remove).toHaveBeenCalledWith('e1')
    act(() => { r.catalog.set({ ...r.catalog.getSnapshot(), lastResult: { entryId: 'other', application: 'applied', warnings: ['x'] } }) })
    expect(r.queryByText('heads up')).toBeNull()
  })

  it('passes acceptOrphan after the orphan confirmation', async () => {
    const r = mount({ snapshot: { servers: [view({ status: { state: 'failed', reason: 'closure-unconfirmed' } })] } })
    r.reconnect.mockResolvedValueOnce({
      kind: 'completed', errorKey: 'error.orphanUnacknowledged',
      result: { application: 'failed', warnings: [], error: { code: 'orphan-unacknowledged', orphanPid: 3 } } as never,
    })
    act(() => { r.nav.actions.openServer('e1') })
    await click(r.getByText('Reconnect'))
    await click(r.getByText('Restart anyway'))
    expect(r.reconnect).toHaveBeenLastCalledWith('e1', { acceptOrphan: true })
  })

  it('creates a server and navigates to the new entry', async () => {
    const r = mount()
    await click(r.getByText('Add server'))
    expect(r.nav.getSnapshot().view).toEqual({ kind: 'create' })
    fillCreate(r)
    await click(r.getByText('Save'))
    expect(r.create).toHaveBeenCalled()
    expect(r.nav.getSnapshot().view).toEqual({ kind: 'server', entryId: 'e2' })
  })

  it('returns to the list when a create result names no entry, and cancel leaves the form', async () => {
    const r = mount({ create: done() })
    await click(r.getByText('Add server'))
    await click(r.getByText('Cancel'))
    expect(r.nav.getSnapshot().view).toEqual({ kind: 'list' })
    await click(r.getByText('Add server'))
    fillCreate(r)
    await click(r.getByText('Save'))
    expect(r.nav.getSnapshot().view).toEqual({ kind: 'list' })
  })

  it('keeps the form with the error for failed, rejected, and unavailable results', async () => {
    const failed: McpOutcome = {
      kind: 'completed', errorKey: 'error.nameConflict',
      result: { application: 'failed', warnings: [], error: { code: 'name-conflict' } } as never,
    }
    const r = mount({ create: failed })
    await click(r.getByText('Add server'))
    fillCreate(r)
    await click(r.getByText('Save'))
    expect(r.nav.getSnapshot().view).toEqual({ kind: 'create' })
    expect(r.getByRole('alert').textContent).toBe('An MCP server with this name already exists')
    r.create.mockResolvedValueOnce({ kind: 'rejected', errorKey: 'error.badRequest' })
    await click(r.getByText('Save'))
    expect(r.getByRole('alert').textContent).toContain('request is invalid')
    r.create.mockResolvedValueOnce({ kind: 'unavailable' })
    await click(r.getByText('Save'))
    expect(r.getByRole('alert').textContent).toContain('operation failed')
  })

  it('edits a server, saves through update, and cancels back to the detail', async () => {
    const r = mount()
    act(() => { r.nav.actions.openServer('e1') })
    await click(r.getByText('Edit'))
    expect(r.nav.getSnapshot().view).toEqual({ kind: 'edit', entryId: 'e1' })
    await click(r.getByText('Cancel'))
    expect(r.nav.getSnapshot().view).toEqual({ kind: 'server', entryId: 'e1' })
    await click(r.getByText('Edit'))
    await click(r.getByText('Save'))
    expect(r.update).toHaveBeenCalledWith('e1', expect.objectContaining({ serverName: 'files' }))
    expect(r.nav.getSnapshot().view).toEqual({ kind: 'server', entryId: 'e1' })
  })
})
