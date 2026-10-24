/** Real SDK probe ownership, failed negotiation recovery, and subprocess quiescence. */
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { StreamableHTTPClientTransport, type Transport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { startConnection, resolveReconnectPolicy, type ConnectionStatus } from '../src/connection.ts'
import { PidStdioClientTransport } from '../src/transport.ts'
import type { Config } from '../src/index.ts'

const { mockTransport } = vi.hoisted(() => ({ mockTransport: vi.fn<() => Transport>() }))
vi.mock('../src/transport.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/transport.ts')>(),
  createTransport: mockTransport,
}))

const config: Config = {
  transport: 'stdio', serverName: 'fixture', command: 'fixture', args: [], env: {}, cwd: '',
  toolCallTimeoutMs: 60_000, failOnStartupError: false,
}
const fixture = fileURLToPath(new URL('./fixtures/negotiation-lifecycle.mjs', import.meta.url))

async function connection(factory: () => Transport, retry: boolean) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const errors: string[] = []
  const warns: string[] = []
  ctx.logger.error = (message: unknown) => { errors.push(String(message)) }
  ctx.logger.warn = (message: unknown) => { warns.push(String(message)) }
  const transports: Transport[] = []
  mockTransport.mockImplementation(() => {
    const transport = factory()
    transports.push(transport)
    return transport
  })
  const handle = startConnection(ctx, config, resolveReconnectPolicy({
    enabled: retry, initialDelayMs: 1, maxDelayMs: 1, maxAttempts: 3,
  }, 'fixture'))
  onTestFinished(async () => {
    for (const transport of transports) await transport.close()
    await handle.dispose()
  })
  return { ...handle, errors, warns, transports }
}

async function stdioFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-negotiation-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const eventsPath = join(root, 'events.jsonl')
  const releasePath = join(root, 'release')
  await writeFile(eventsPath, '')
  const events = async (): Promise<{ event: string; pid: number; previousAlive?: boolean }[]> => (await readFile(eventsPath, 'utf8'))
    .split('\n').filter(Boolean).map(line => JSON.parse(line) as { event: string; pid: number; previousAlive?: boolean })
  const handle = await connection(() => new StdioClientTransport({
    command: process.execPath, args: [fixture, eventsPath, releasePath], env: {},
  }), false)
  return { handle, events, release: () => writeFile(releasePath, '') }
}

/**
 * A real fixture child whose shutdown is never reported: close resolves without
 * stopping the child or firing onclose. In `tools` mode the handshake succeeds
 * and the initial tool listing fails; in `hang` mode the handshake succeeds and the tool listing
 * never answers. The child is reaped when the test finishes.
 */
class UnconfirmedCloseTransport extends PidStdioClientTransport {
  constructor(private readonly mode: 'tools' | 'hang') {
    super({ command: process.execPath, args: [fixture, unconfirmedPaths.events, unconfirmedPaths.release], env: {} })
    onTestFinished(() => {
      const pid = this.spawnedPid
      if (pid !== undefined) try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
    })
  }

  override send(message: Parameters<Transport['send']>[0]): Promise<void> {
    if ('method' in message && message.method === 'tools/list') {
      return this.mode === 'hang' ? new Promise<void>(() => {}) : Promise.reject(new Error('tool listing failed'))
    }
    return super.send(message)
  }

  override close(): Promise<void> {
    return Promise.resolve()
  }

  reportClosed(): void {
    this.onclose?.()
  }
}

const unconfirmedPaths = { events: '', release: '' }

/** Point the fixture at a fresh barrier directory with discovery already released. */
async function unconfirmedFixtureFiles(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-unconfirmed-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  unconfirmedPaths.events = join(root, 'events.jsonl')
  unconfirmedPaths.release = join(root, 'release')
  await writeFile(unconfirmedPaths.events, '')
  await writeFile(unconfirmedPaths.release, '')
}

/** Run a failed attempt on an unconfirmed-close child until the close barrier gives up. */
async function unconfirmedClose() {
  await unconfirmedFixtureFiles()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => { vi.useRealTimers() })
  const handle = await connection(() => new UnconfirmedCloseTransport('tools'), true)
  const statuses: ConnectionStatus[] = []
  handle.subscribe(() => { statuses.push(handle.status()) })
  while (handle.status().state !== 'closing') await new Promise(resolve => setImmediate(resolve))
  await vi.advanceTimersByTimeAsync(5_000)
  await handle.ready
  return { handle, statuses, transport: handle.transports[0] as UnconfirmedCloseTransport }
}

describe('SDK negotiation lifecycle', () => {
  it('reaps the probe before starting the serving process', async () => {
    const { handle, events, release } = await stdioFixture()
    await release()
    expect(await handle.ready).toEqual({})
    const observed = await events()
    const starts = observed.filter(item => item.event === 'start')
    expect(starts).toHaveLength(2)
    expect(starts[1]!.previousAlive).toBe(false)
    await handle.dispose()
    for (const item of starts) expect(() => process.kill(item.pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
  })

  it('disposes during a probe without starting or retaining a serving process', async () => {
    const { handle, events, release } = await stdioFixture()
    await vi.waitFor(async () => {
      expect((await events()).some(item => item.event === 'server/discover')).toBe(true)
    }, { timeout: 15_000 })
    const disposing = handle.dispose()
    await release()
    await disposing
    const starts = (await events()).filter(item => item.event === 'start')
    expect(starts).toHaveLength(1)
    for (const item of starts) expect(() => process.kill(item.pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
    expect(handle.errors).toEqual([])
  })

  it('retries failed HTTP probes without waiting for a Client close event', async () => {
    let requests = 0
    const server = createServer((_request, response) => {
      requests += 1
      response.writeHead(503)
      response.end('temporary failure')
    })
    onTestFinished(async () => {
      server.closeAllConnections()
      const closed: PromiseWithResolvers<void> = Promise.withResolvers()
      server.close((error) => {
        if (error) closed.reject(error)
        else closed.resolve()
      })
      await closed.promise
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind a TCP address')
    const url = new URL(`http://127.0.0.1:${address.port}/mcp`)
    const handle = await connection(() => new StreamableHTTPClientTransport(url), true)
    const statuses: ConnectionStatus[] = []
    handle.subscribe(() => { statuses.push(handle.status()) })
    expect((await handle.ready).error).toBeDefined()
    expect(handle.errors).toEqual([])
    await vi.waitFor(() => { expect(handle.errors.some(line => line.includes('giving up after 3'))).toBe(true) })
    expect(statuses.length).toBeGreaterThan(0)
    for (const status of [...statuses, handle.status()]) expect(status).not.toHaveProperty('orphanPid')
    expect(requests).toBe(4)
    expect(handle.warns.filter(line => line.includes('connection failed; retrying'))).toHaveLength(3)
  })

  it('retries failed stdio probes when no child could be spawned', async () => {
    const handle = await connection(() => new StdioClientTransport({
      command: join(fixture, 'missing-command'), env: {},
    }), true)
    expect((await handle.ready).error).toBeDefined()
    expect(handle.errors).toEqual([])
    await vi.waitFor(() => { expect(handle.errors.some(line => line.includes('giving up after 3'))).toBe(true) })
    expect(handle.transports).toHaveLength(4)
    expect(handle.warns.filter(line => line.includes('connection failed; retrying'))).toHaveLength(3)
  })

  it('stops retries when a failed probe cannot confirm transport cleanup', async () => {
    const close = vi.fn()
      .mockRejectedValueOnce(new Error('SDK shutdown failed'))
      .mockRejectedValueOnce(new Error('supervisor shutdown failed'))
      .mockResolvedValue(undefined)
    const handle = await connection(() => ({
      start: () => Promise.reject(new Error('probe failed')),
      send: () => Promise.resolve(),
      close,
    }), true)
    expect((await handle.ready).error).toBeDefined()
    expect(handle.errors).toEqual([
      'mcp-client(fixture): failed generation could not confirm transport closure — reconnect stopped to avoid overlapping server processes; reload the plugin or restart the Host to retry',
    ])
    expect(handle.warns.some(line => line.includes('connection failed; retrying'))).toBe(false)
    expect(handle.transports).toHaveLength(1)
  })

  it('reports the orphan PID when a failed attempt never confirms closure', async () => {
    const { handle, statuses, transport } = await unconfirmedClose()
    expect(transport.spawnedPid).toEqual(expect.any(Number))
    expect(handle.status()).toMatchObject({ state: 'failed', reason: 'closure-unconfirmed', orphanPid: transport.spawnedPid })
    expect(statuses.at(-1)).toMatchObject({ state: 'failed', orphanPid: transport.spawnedPid })
    expect(handle.retry()).toBe('needs-restart')
    expect(handle.transports).toHaveLength(1)
  })

  it('clears the orphan PID when the close is reported afterwards', async () => {
    const { handle, statuses, transport } = await unconfirmedClose()
    const before = statuses.length
    transport.reportClosed()
    await vi.waitFor(() => { expect(handle.status()).not.toHaveProperty('orphanPid') })
    expect(handle.status()).toMatchObject({ state: 'failed', reason: 'closure-unconfirmed' })
    expect(statuses.length).toBeGreaterThan(before)
    expect(statuses.at(-1)).not.toHaveProperty('orphanPid')
  })

  it('sets the orphan PID from the current transport when disposal cannot confirm closure', async () => {
    await unconfirmedFixtureFiles()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    onTestFinished(() => { vi.useRealTimers() })
    const handle = await connection(() => new UnconfirmedCloseTransport('hang'), false)
    const transport = handle.transports[0] as UnconfirmedCloseTransport
    const statuses: ConnectionStatus[] = []
    handle.subscribe(() => { statuses.push(handle.status()) })
    // Connected and attached: the initial tool listing is the request left hanging.
    await vi.waitFor(() => { expect(transport.spawnedPid).toBeDefined() })
    for (let i = 0; i < 100; i++) await new Promise(resolve => setImmediate(resolve))
    const before = statuses.length
    const disposing = handle.dispose()
    await vi.advanceTimersByTimeAsync(5_000)
    // The hung handshake only settles once the transport reports closure.
    transport.reportClosed()
    await disposing
    expect(handle.errors.some(line => line.includes('could not be confirmed during disposal'))).toBe(true)
    expect(statuses.length).toBeGreaterThan(before)
    expect(statuses.at(-1)).toEqual({ state: 'failed', reason: 'closure-unconfirmed', orphanPid: transport.spawnedPid })
  })
})
