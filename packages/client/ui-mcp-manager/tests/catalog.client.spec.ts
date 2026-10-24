/** MCP catalog: load, coalesced refresh, mutations, error mapping, pending state, and the optional toggle. */
import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChangeResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { McpChangeResult, McpServerDraft, McpServerView } from '@deepseek-ai/dsh-mcp-manager/types'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import { changeErrorKey, McpCatalog, wireErrorKey } from '../src/client/catalog.ts'
import { entryId as brand } from './fixtures.client.ts'

const draft: McpServerDraft = { serverName: 'files', transport: 'stdio', command: 'node' }
function server(id: string): McpServerView {
  return {
    entryId: brand(id), serverName: id, transport: 'stdio', enabled: true, ownership: 'profile',
    config: { serverName: id, transport: 'stdio', command: 'node' }, secrets: [],
    status: { state: 'disabled' }, tools: [],
  }
}

const applied = (id?: string): McpChangeResult => ({
  ...id === undefined ? {} : { entryId: brand(id) }, application: 'applied', warnings: [],
})

function failedWith(code: NonNullable<McpChangeResult['error']>['code'], orphanPid?: number): McpChangeResult {
  return {
    entryId: brand('e1'), application: 'failed', warnings: ['w'],
    error: { code, ...orphanPid === undefined ? {} : { orphanPid } },
  }
}

const okOf = <T>(value: T) => ({ ok: true as const, value })
const wire = (code: string) => ({ ok: false as const, error: new RemoteError(code as never, 'boom', undefined as never) })

function setup(overrides: Record<string, unknown> = {}, withManager = true) {
  const mcp = {
    list: vi.fn(async () => okOf({ servers: [server('e1')] })),
    create: vi.fn(async () => okOf(applied('e2'))),
    update: vi.fn(async () => okOf(applied('e1'))),
    removeServer: vi.fn(async () => okOf(applied('e1'))),
    reconnect: vi.fn(async () => okOf(applied('e1'))),
    ...overrides,
  }
  const toggle = vi.fn<TypertRemoteNamespaceMap['pluginManager']['setPluginEnabled']>(
    async () => okOf<ChangeResult>({ changed: true, application: 'applied', stage: 'enable', target: 'e1' }),
  )
  const manager: Pick<TypertRemoteNamespaceMap['pluginManager'], 'setPluginEnabled'> = { setPluginEnabled: toggle }
  const pluginManager = { setPluginEnabled: toggle }
  const catalog = new McpCatalog(mcp, withManager ? manager as TypertRemoteNamespaceMap['pluginManager'] : undefined)
  return { catalog, mcp, pluginManager }
}

describe('error key mapping', () => {
  it('maps wire and operation codes', () => {
    expect(wireErrorKey('mcp/not-found')).toBe('error.notFound')
    expect(wireErrorKey('gateway/bad-request')).toBe('error.badRequest')
    expect(wireErrorKey('other')).toBe('error.operationError')
    expect(changeErrorKey('name-conflict')).toBe('error.nameConflict')
    expect(changeErrorKey('read-only')).toBe('error.readOnly')
    expect(changeErrorKey('invalid-config')).toBe('error.invalidConfig')
    expect(changeErrorKey('not-active')).toBe('error.notActive')
    expect(changeErrorKey('orphan-unacknowledged')).toBe('error.orphanUnacknowledged')
    expect(changeErrorKey('operation-error')).toBe('error.operationError')
  })
})

describe('McpCatalog refresh', () => {
  it('starts loading, then publishes the servers', async () => {
    const { catalog } = setup()
    expect(catalog.snapshots.getSnapshot()).toMatchObject({ phase: 'loading', servers: [] })
    await catalog.refresh()
    const snapshot = catalog.snapshots.getSnapshot()
    expect(snapshot.phase).toBe('ready')
    expect(snapshot.servers.map(row => row.entryId)).toEqual(['e1'])
    expect(snapshot.error).toBeUndefined()
  })

  it('keeps rows and maps the code on a wire failure, then recovers', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce(okOf({ servers: [server('e1')] }))
      .mockResolvedValueOnce(wire('gateway/bad-request'))
      .mockResolvedValueOnce(okOf({ servers: [] }))
    const { catalog } = setup({ list })
    await catalog.refresh()
    await catalog.refresh()
    expect(catalog.snapshots.getSnapshot()).toMatchObject({ phase: 'failed', error: 'error.badRequest' })
    expect(catalog.snapshots.getSnapshot().servers).toHaveLength(1)
    await catalog.refresh()
    expect(catalog.snapshots.getSnapshot().phase).toBe('ready')
    expect(catalog.snapshots.getSnapshot().error).toBeUndefined()
  })

  it('maps a rejected list to the operation error', async () => {
    const { catalog } = setup({ list: vi.fn(async () => { throw new Error('down') }) })
    await catalog.refresh()
    expect(catalog.snapshots.getSnapshot()).toMatchObject({ phase: 'failed', error: 'error.operationError' })
  })

  it('shares the in-flight list and runs exactly one follow-up for calls during it', async () => {
    const gates: Array<() => void> = []
    const list = vi.fn(() => new Promise<ReturnType<typeof okOf>>((resolve) => {
      gates.push(() => { resolve(okOf({ servers: [] })) })
    }))
    const { catalog } = setup({ list })
    const first = catalog.refresh()
    const second = catalog.refresh()
    const third = catalog.refresh()
    expect(list).toHaveBeenCalledTimes(1)
    expect(second).toBe(third)
    gates[0]!()
    await vi.waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    gates[1]!()
    await Promise.all([first, second, third])
    expect(list).toHaveBeenCalledTimes(2)
  })
})

describe('McpCatalog mutations', () => {
  it('creates without a row pending, records the result, and refreshes', async () => {
    const { catalog, mcp } = setup()
    const outcome = await catalog.create(draft)
    expect(mcp.create).toHaveBeenCalledWith(draft)
    expect(outcome).toEqual({ kind: 'completed', result: applied('e2') })
    expect(catalog.snapshots.getSnapshot().lastResult).toEqual({ entryId: 'e2', application: 'applied', warnings: [] })
    expect(mcp.list).toHaveBeenCalledTimes(1)
  })

  it('sets pending while a row saves and clears it after', async () => {
    let release!: () => void
    const update = vi.fn(() => new Promise<ReturnType<typeof okOf>>((resolve) => { release = () => { resolve(okOf(applied())) } }))
    const { catalog } = setup({ update })
    const done = catalog.update('e1', draft)
    expect(catalog.snapshots.getSnapshot().pending).toEqual({ e1: 'saving' })
    release()
    await done
    expect(catalog.snapshots.getSnapshot().pending).toEqual({})
    expect(catalog.snapshots.getSnapshot().lastResult).toEqual({ entryId: 'e1', application: 'applied', warnings: [] })
  })

  it('tracks removing and reconnecting with their options', async () => {
    const seen: string[] = []
    const ref: { catalog?: McpCatalog } = {}
    const track = (value: McpChangeResult) => async () => {
      seen.push(ref.catalog!.snapshots.getSnapshot().pending.e1 as string)
      return okOf(value)
    }
    const { catalog, mcp } = setup({ removeServer: vi.fn(track(applied('e1'))), reconnect: vi.fn(track(applied('e1'))) })
    ref.catalog = catalog
    await catalog.remove('e1')
    await catalog.reconnect('e1', { acceptOrphan: true })
    expect(seen).toEqual(['removing', 'reconnecting'])
    expect(mcp.reconnect).toHaveBeenCalledWith('e1', { acceptOrphan: true })
  })

  it.each([
    ['name-conflict', 'error.nameConflict'],
    ['read-only', 'error.readOnly'],
    ['invalid-config', 'error.invalidConfig'],
    ['not-active', 'error.notActive'],
    ['orphan-unacknowledged', 'error.orphanUnacknowledged'],
    ['operation-error', 'error.operationError'],
  ] as const)('maps a %s result to %s', async (code, key) => {
    const result = failedWith(code, code === 'orphan-unacknowledged' ? 4242 : undefined)
    const { catalog } = setup({ reconnect: vi.fn(async () => okOf(result)) })
    const outcome = await catalog.reconnect('e1')
    expect(outcome).toEqual({ kind: 'completed', result, errorKey: key })
    expect(catalog.snapshots.getSnapshot().lastResult).toEqual({
      entryId: 'e1', application: 'failed', warnings: ['w'], errorCode: code,
    })
    if (code === 'orphan-unacknowledged') {
      expect(outcome.kind === 'completed' && outcome.result.error?.orphanPid).toBe(4242)
    }
  })

  it.each([
    ['mcp/not-found', 'error.notFound'],
    ['gateway/bad-request', 'error.badRequest'],
    ['gateway/other', 'error.operationError'],
  ] as const)('maps wire error %s to %s and still refreshes', async (code, key) => {
    const { catalog, mcp } = setup({ removeServer: vi.fn(async () => wire(code)) })
    const outcome = await catalog.remove('e1')
    expect(outcome).toEqual({ kind: 'rejected', errorKey: key })
    expect(catalog.snapshots.getSnapshot().lastResult).toEqual({
      entryId: 'e1', application: 'failed', warnings: [], errorCode: 'operation-error',
    })
    expect(catalog.snapshots.getSnapshot().pending).toEqual({})
    expect(mcp.list).toHaveBeenCalledTimes(1)
  })

  it('treats a rejected call as an operation error and clears pending', async () => {
    const { catalog } = setup({ create: vi.fn(async () => { throw new Error('down') }) })
    const outcome = await catalog.create(draft)
    expect(outcome).toEqual({ kind: 'rejected', errorKey: 'error.operationError' })
    expect(catalog.snapshots.getSnapshot().lastResult).toEqual({ application: 'failed', warnings: [], errorCode: 'operation-error' })
  })

  it('records no row when neither the call nor the result names one', async () => {
    const result = { application: 'failed', warnings: [] } as McpChangeResult
    const { catalog } = setup({ create: vi.fn(async () => okOf(result)) })
    await catalog.create(draft)
    expect(catalog.snapshots.getSnapshot().lastResult).toEqual({ application: 'failed', warnings: [] })
  })

  it('keeps the called row id when the result has none', async () => {
    const { catalog } = setup({ reconnect: vi.fn(async () => okOf(applied())) })
    await catalog.reconnect('e9')
    expect(catalog.snapshots.getSnapshot().lastResult?.entryId).toBe('e9')
  })
})

describe('McpCatalog toggle', () => {
  it('is unavailable without Plugin Manager and touches nothing', async () => {
    const { catalog, mcp } = setup({}, false)
    expect(catalog.canToggle).toBe(false)
    expect(await catalog.setEnabled('e1', true)).toEqual({ kind: 'unavailable' })
    expect(mcp.list).not.toHaveBeenCalled()
    expect(catalog.snapshots.getSnapshot().pending).toEqual({})
  })

  it('toggles through Plugin Manager with toggling pending, then refreshes', async () => {
    const { catalog, mcp, pluginManager } = setup()
    expect(catalog.canToggle).toBe(true)
    let during: unknown
    pluginManager.setPluginEnabled.mockImplementationOnce(async () => {
      during = catalog.snapshots.getSnapshot().pending
      return okOf({ changed: true, application: 'restart-required', stage: 'enable', target: 'e1', warnings: ['x'] })
    })
    const outcome = await catalog.setEnabled('e1', false)
    expect(during).toEqual({ e1: 'toggling' })
    expect(pluginManager.setPluginEnabled).toHaveBeenCalledWith('e1', false)
    expect(outcome).toEqual({
      kind: 'completed', result: { entryId: 'e1', application: 'restart-required', warnings: ['x'] },
    })
    expect(mcp.list).toHaveBeenCalledTimes(1)
  })

  it('reads a failed, cancelled, or errored Plugin Manager result as an operation error', async () => {
    const { catalog, pluginManager } = setup()
    pluginManager.setPluginEnabled
      .mockResolvedValueOnce(okOf({ changed: false, application: 'cancelled', stage: 'enable', target: 'e1' }))
      .mockResolvedValueOnce(okOf({
        changed: false, application: 'applied', stage: 'enable', target: 'e1',
        error: { code: 'unknown-plugin', diagnostic: 'gone' },
      }))
    const cancelled = await catalog.setEnabled('e1', true)
    expect(cancelled).toMatchObject({
      kind: 'completed', errorKey: 'error.operationError',
      result: { application: 'failed', error: { code: 'operation-error' } },
    })
    const errored = await catalog.setEnabled('e1', true)
    expect(errored).toMatchObject({
      kind: 'completed', result: { error: { code: 'operation-error', diagnostic: 'gone' } },
    })
  })

  it('maps a wire error from Plugin Manager', async () => {
    const { catalog, pluginManager } = setup()
    pluginManager.setPluginEnabled.mockResolvedValueOnce(wire('mcp/not-found'))
    expect(await catalog.setEnabled('e1', true)).toEqual({ kind: 'rejected', errorKey: 'error.notFound' })
  })
})
