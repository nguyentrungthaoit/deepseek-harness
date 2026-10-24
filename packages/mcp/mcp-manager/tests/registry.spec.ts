/** The `mcp` Remote over real `dsh-mcp-client` connections and profile patch rows. */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type McpServerRegistry from '../src/index.ts'
import type { McpServerId, McpServerView } from '../src/types.ts'
import { MCP_MODULE, mcpRow, registryFixture, stdioRow } from './registry-fixture.ts'

const SECRET = 'secret-token-value'
const UNREACHABLE = 'http://127.0.0.1:9/mcp'

function registry(ctx: Context): McpServerRegistry {
  return ctx.mcpServers as McpServerRegistry
}

async function server(ctx: Context, serverName: string): Promise<McpServerView> {
  const { servers } = await registry(ctx).list()
  const found = servers.find(row => row.serverName === serverName)
  if (found === undefined) throw new Error(`no row ${serverName}`)
  return found
}

async function connected(ctx: Context, serverName: string): Promise<McpServerView> {
  await vi.waitFor(async () => { expect((await server(ctx, serverName)).status.state).toBe('connected') }, { timeout: 15_000 })
  return await server(ctx, serverName)
}

describe('list', () => {
  it('reports a profile row with its live status and tools but no secret values', async () => {
    const { ctx } = await registryFixture({ profile: [{ insert: [mcpRow('mcp-fixture', stdioRow('fixture', { env: { TOKEN: SECRET } }))] }] })
    const row = await connected(ctx, 'fixture')
    expect(row).toMatchObject({
      patchId: 'mcp-fixture', ownership: 'profile', enabled: true, transport: 'stdio',
      secrets: [{ path: ['env', 'TOKEN'], set: true }], serverInfo: { name: 'fixture', version: '1.0.0' },
      tools: [{ rawName: 'echo', publicName: 'mcp__fixture__echo', title: 'Echo', description: 'Echoes text.' }],
    })
    expect(JSON.stringify(await registry(ctx).list())).not.toContain(SECRET)
  })

  it('reports rows the profile patch cannot address as read-only', async () => {
    const twin = (group: string) => ({ id: group, name: 'cordis:group', group: true, config: [{ id: 'mcp-twin', name: MCP_MODULE, disabled: true }] })
    const { ctx } = await registryFixture({ layer: [twin('first'), twin('second')] })
    const { servers } = await registry(ctx).list()
    expect(servers.map(item => [item.ownership, item.readOnlyReason, item.patchId])).toEqual([['readonly', 'unaddressable', undefined]])
    expect(servers[0]!.config).toEqual({ transport: 'stdio', serverName: 'undefined' })
    expect(await registry(ctx).removeServer(servers[0]!.entryId)).toMatchObject({ application: 'failed', error: { code: 'read-only' } })
  })

  it('reports a bundle row as layer-owned and a disabled row as disabled', async () => {
    const { ctx } = await registryFixture({ layer: [mcpRow('mcp-layer', stdioRow('layered'), { disabled: true })] })
    expect(await server(ctx, 'layered')).toMatchObject({ ownership: 'layer', enabled: false, status: { state: 'disabled' }, tools: [] })
  })
})

describe('create', () => {
  it('inserts a Streamable HTTP row that keeps retrying, then refuses a duplicate name', async () => {
    const { ctx, profile } = await registryFixture()
    const result = await registry(ctx).create({
      transport: 'streamable-http', serverName: 'remote', url: UNREACHABLE, headers: { Authorization: { value: SECRET } },
      reconnect: { initialDelayMs: 60_000, maxDelayMs: 60_000 },
    })
    expect(result).toMatchObject({ application: 'applied', entryId: expect.any(String) as string })
    const text = readFileSync(profile.patchPath, 'utf8')
    expect(text).toContain('id: mcp-remote')
    expect(text).toContain(SECRET)
    await vi.waitFor(async () => { expect((await server(ctx, 'remote')).status.state).toBe('backoff') }, { timeout: 15_000 })
    const duplicate = await registry(ctx).create({ transport: 'stdio', serverName: 'remote', command: 'x' })
    expect(duplicate).toMatchObject({ application: 'failed', error: { code: 'name-conflict' } })
  })

  it('reports no warnings for other rows of the profile that stay inactive', async () => {
    const { ctx } = await registryFixture({ layer: [mcpRow('mcp-broken', { transport: 'stdio', serverName: 'broken' })] })
    const result = await registry(ctx).create({
      transport: 'streamable-http', serverName: 'quiet', url: UNREACHABLE, reconnect: { initialDelayMs: 60_000, maxDelayMs: 60_000 },
    })
    expect(result).toMatchObject({ application: 'applied', warnings: [] })
  })

  it('restores the patch when the client rejects the row', async () => {
    const { ctx, profile } = await registryFixture()
    const before = readFileSync(profile.patchPath, 'utf8')
    const result = await registry(ctx).create({ transport: 'stdio', serverName: 'bad name!', command: 'x' })
    expect(result).toMatchObject({ application: 'failed', error: { code: 'invalid-config' } })
    expect(readFileSync(profile.patchPath, 'utf8')).toBe(before)
  })

  it('restores the patch when a strict startup fails', async () => {
    const { ctx, profile } = await registryFixture()
    const before = readFileSync(profile.patchPath, 'utf8')
    const result = await registry(ctx).create({
      transport: 'streamable-http', serverName: 'strict', url: UNREACHABLE, failOnStartupError: true,
      headers: { Authorization: { value: SECRET } },
    })
    expect(result).toMatchObject({ application: 'failed', error: { code: 'invalid-config' } })
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(readFileSync(profile.patchPath, 'utf8')).toBe(before)
  })

  it('refuses a malformed draft over the wire', async () => {
    const { ctx } = await registryFixture()
    const failure = await registry(ctx).create({ transport: 'stdio', serverName: 's' } as never).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
  })
})

describe('update', () => {
  it('keeps a stored secret while replacing other fields', async () => {
    const { ctx, profile } = await registryFixture({ profile: [{ insert: [mcpRow('mcp-fixture', stdioRow('fixture', { env: { TOKEN: SECRET } }))] }] })
    const row = await connected(ctx, 'fixture')
    const result = await registry(ctx).update(row.entryId, {
      transport: 'stdio', serverName: 'fixture', command: { keep: true }, args: { keep: true }, env: { TOKEN: { keep: true } },
      toolCallTimeoutMs: 5_000,
    })
    expect(result).toMatchObject({ application: 'applied', entryId: row.entryId })
    const text = readFileSync(profile.patchPath, 'utf8')
    expect(text).toContain(SECRET)
    expect(text).toContain('toolCallTimeoutMs: 5000')
    await connected(ctx, 'fixture')
  })

  it('writes a layer row as an override and refuses a name another row uses', async () => {
    const { ctx, profile } = await registryFixture({
      layer: [mcpRow('mcp-layer', stdioRow('layered'))],
      profile: [{ insert: [mcpRow('mcp-other', stdioRow('other'), { disabled: true })] }],
    })
    const row = await connected(ctx, 'layered')
    const conflict = await registry(ctx).update(row.entryId, { transport: 'stdio', serverName: 'other', command: { keep: true } })
    expect(conflict).toMatchObject({ application: 'failed', error: { code: 'name-conflict' } })
    const result = await registry(ctx).update(row.entryId, { transport: 'stdio', serverName: 'layered', command: { keep: true }, args: { keep: true }, cwd: '' })
    expect(result.application).toBe('applied')
    expect(readFileSync(profile.patchPath, 'utf8')).toContain('id: mcp-layer')
    expect((await server(ctx, 'layered')).ownership).toBe('layer')
    const other = await server(ctx, 'other')
    const disabledUpdate = await registry(ctx).update(other.entryId, { transport: 'stdio', serverName: 'other', command: 'changed' })
    expect(disabledUpdate.application).toBe('applied')
    expect((await server(ctx, 'other')).config).toMatchObject({ command: 'changed' })
  })

  it('reports overridden when the saved config is not the effective one', async () => {
    const { ctx } = await registryFixture({ profile: [{ insert: [mcpRow('mcp-fixture', stdioRow('fixture'))] }] })
    const row = await connected(ctx, 'fixture')
    const editor = ctx.configEditor
    const rewrite = vi.spyOn(editor, 'rewrite').mockResolvedValueOnce([])
    const result = await registry(ctx).update(row.entryId, { transport: 'stdio', serverName: 'fixture', command: 'changed' })
    expect(rewrite).toHaveBeenCalledOnce()
    expect(result.application).toBe('overridden')
  })

  it('reports an unknown entry as not found', async () => {
    const { ctx } = await registryFixture()
    const failure = await registry(ctx).update('nope' as McpServerId, { transport: 'stdio', serverName: 'x', command: 'x' })
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'mcp/not-found', details: { entryId: 'nope' } })
  })
})

describe('removeServer', () => {
  it('removes a profile row and refuses a layer row', async () => {
    const { ctx, profile } = await registryFixture({
      layer: [mcpRow('mcp-layer', stdioRow('layered'), { disabled: true })],
      profile: [{ insert: [mcpRow('mcp-fixture', stdioRow('fixture'))] }],
    })
    const row = await connected(ctx, 'fixture')
    expect(await registry(ctx).removeServer(row.entryId)).toMatchObject({ application: 'applied' })
    expect(readFileSync(profile.patchPath, 'utf8')).not.toContain('mcp-fixture')
    expect((await registry(ctx).list()).servers.map(item => item.serverName)).toEqual(['layered'])
    const layered = await server(ctx, 'layered')
    expect(await registry(ctx).removeServer(layered.entryId)).toMatchObject({ application: 'failed', error: { code: 'read-only' } })
  })

  it('reports a lock timeout as an operation error', async () => {
    const { ctx } = await registryFixture({ profile: [{ insert: [mcpRow('mcp-fixture', stdioRow('fixture'))] }] })
    const row = await connected(ctx, 'fixture')
    vi.spyOn(ctx.configEditor, 'rewrite').mockRejectedValueOnce('lock timed out')
    expect(await registry(ctx).removeServer(row.entryId)).toMatchObject({ application: 'failed', error: { code: 'operation-error', diagnostic: 'lock timed out' } })
  })
})

describe('reconnect', () => {
  it('starts a fresh attempt from backoff and refuses while connected or disabled', async () => {
    const { ctx } = await registryFixture({
      layer: [mcpRow('mcp-off', stdioRow('off'), { disabled: true })],
      profile: [{ insert: [
        mcpRow('mcp-fixture', stdioRow('fixture')),
        mcpRow('mcp-remote', { transport: 'streamable-http', serverName: 'remote', url: UNREACHABLE, reconnect: { initialDelayMs: 60_000, maxDelayMs: 60_000 } }),
      ] }],
    })
    const live = await connected(ctx, 'fixture')
    expect(await registry(ctx).reconnect(live.entryId)).toMatchObject({ application: 'failed', error: { code: 'not-active' } })
    const off = await server(ctx, 'off')
    expect(await registry(ctx).reconnect(off.entryId)).toMatchObject({ application: 'failed', error: { code: 'not-active' } })
    await vi.waitFor(async () => { expect((await server(ctx, 'remote')).status.state).toBe('backoff') }, { timeout: 15_000 })
    const remote = await server(ctx, 'remote')
    expect(await registry(ctx).reconnect(remote.entryId)).toMatchObject({ application: 'applied' })
  })
})
