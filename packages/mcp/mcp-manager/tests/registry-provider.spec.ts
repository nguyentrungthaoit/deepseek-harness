/** Registry behavior driven by controllable status providers: reconnect, restart, orphans, scrubbing, and registration. */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { createScope } from '@deepseek-ai/dsh-scope'
import type McpServerRegistry from '../src/index.ts'
import { MASK } from '../src/secrets.ts'
import type { McpConnectionStatus, McpRetryOutcome, McpServerChange, McpServerStatusProvider, McpServerView } from '../src/types.ts'
import { mcpRow, registryFixture } from './registry-fixture.ts'

const SECRET = 'provider-secret-value'

class FakeProvider implements McpServerStatusProvider {
  readonly transport = 'stdio' as const
  state: McpConnectionStatus = { state: 'connected', since: 1 }
  outcome: McpRetryOutcome = 'started'
  private readonly listeners = new Set<() => void>()
  constructor(readonly serverName: string) {}
  status(): McpConnectionStatus { return this.state }
  tools(): [] { return [] }
  serverInfo(): undefined { return undefined }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  retry(): McpRetryOutcome { return this.outcome }
  set(state: McpConnectionStatus): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}

/** A stand-in client module whose connections the test controls. */
function fakeClient() {
  const control = { fail: false, providers: [] as FakeProvider[] }
  const client = {
    name: 'fake-mcp-client',
    apply(ctx: Context, config: { serverName: string }) {
      if (control.fail) throw new Error('apply failed')
      const provider = new FakeProvider(config.serverName)
      control.providers.push(provider)
      ctx.inject(['mcpServers'], (inner) => { inner.mcpServers.register(ctx.fiber.entry?.id, provider) })
    },
  }
  return { client, control }
}

const row = mcpRow('mcp-fake', { transport: 'stdio', serverName: 'fake', command: 'fake', env: { TOKEN: SECRET } })

async function setup(options: { hmr?: boolean; fail?: boolean } = {}) {
  const { client, control } = fakeClient()
  control.fail = options.fail === true
  const { ctx } = await registryFixture({ client, profile: [{ insert: [row] }], ...options.hmr === false ? { hmr: false } : {} })
  const registry = ctx.mcpServers as McpServerRegistry
  const view = async (): Promise<McpServerView> => (await registry.list()).servers[0] as McpServerView
  const changes: McpServerChange[] = []
  ctx.on('mcp/change', (change) => { changes.push(change) })
  return { ctx, control, registry, view, changes, provider: () => control.providers.at(-1) as FakeProvider }
}

describe('reconnect through a provider', () => {
  it.each([
    ['started', { application: 'applied' }],
    ['busy', { application: 'failed', error: { code: 'not-active' } }],
    ['disposed', { application: 'failed', error: { code: 'not-active' } }],
  ] as const)('maps a %s retry', async (outcome, expected) => {
    const { registry, view, provider } = await setup()
    provider().outcome = outcome
    expect(await registry.reconnect((await view()).entryId)).toMatchObject(expected)
  })

  it('asks before restarting over an orphaned process, then restarts', async () => {
    const { registry, view, provider, control } = await setup()
    provider().outcome = 'needs-restart'
    provider().set({ state: 'failed', reason: 'closure-unconfirmed', orphanPid: 4242 })
    const { entryId } = await view()
    expect(await registry.reconnect(entryId)).toMatchObject({
      application: 'failed', error: { code: 'orphan-unacknowledged', orphanPid: 4242 },
    })
    const result = await registry.reconnect(entryId, { acceptOrphan: true })
    expect(result.application).toBe('applied')
    expect(result.warnings).toEqual(['MCP server process 4242 could not be confirmed stopped and may still run'])
    expect(control.providers).toHaveLength(2)
  })

  it('reports a restart that fails as an operation error and recovers later', async () => {
    const { registry, view, provider, control } = await setup()
    provider().outcome = 'needs-restart'
    const { entryId } = await view()
    control.fail = true
    expect(await registry.reconnect(entryId)).toMatchObject({ application: 'failed', error: { code: 'operation-error', diagnostic: 'apply failed' } })
    expect((await view()).status).toEqual({ state: 'not-loaded' })
    control.fail = false
    expect(await registry.reconnect(entryId)).toMatchObject({ application: 'applied' })
    expect((await view()).status.state).toBe('connected')
  })

  it('requires a restart without HMR', async () => {
    const { registry, view, provider } = await setup({ hmr: false })
    provider().outcome = 'needs-restart'
    expect(await registry.reconnect((await view()).entryId)).toMatchObject({ application: 'restart-required' })
  })
})

describe('status projection', () => {
  it('masks secret values in the last error and reports status changes', async () => {
    const { view, provider, changes } = await setup()
    provider().set({ state: 'backoff', attempt: 1, maxAttempts: 3, retryAt: 9, lastError: `rejected ${SECRET}` })
    expect((await view()).status).toEqual({ state: 'backoff', attempt: 1, maxAttempts: 3, retryAt: 9, lastError: `rejected ${MASK}` })
    expect(changes.at(-1)).toMatchObject({ reason: 'status' })
  })

  it('reports an orphan left by a disposal on the next save', async () => {
    const { registry, view, provider } = await setup()
    provider().set({ state: 'failed', reason: 'closure-unconfirmed', orphanPid: 7 })
    const { entryId } = await view()
    const result = await registry.update(entryId, { transport: 'stdio', serverName: 'fake', command: 'fake', env: { TOKEN: { keep: true } } })
    expect(result.warnings).toContain('MCP server process 7 could not be confirmed stopped and may still run')
  })
})

describe('register', () => {
  it('ignores Agent-scoped and entry-less registrations and refuses a duplicate entry', async () => {
    const { ctx, view, changes } = await setup()
    const scoped = createScope(ctx, {})
    const fake = new FakeProvider('other')
    scoped.ctx.inject(['mcpServers'], (inner) => { inner.mcpServers.register('scoped-entry', fake)() })
    ctx.inject(['mcpServers'], (inner) => { inner.mcpServers.register(undefined, fake)() })
    expect(changes).toEqual([])
    const { entryId } = await view()
    expect(() => ctx.get('mcpServers')?.register(entryId, fake)).toThrow('already registered')
    await scoped.rawDispose()
  })
})
