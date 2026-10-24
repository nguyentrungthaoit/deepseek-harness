import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Service } from '@deepseek-ai/cordis'
import type { McpServerRegistration, McpServerStatusProvider } from '@deepseek-ai/dsh-mcp-manager/types'
import { registerServerContext } from '../src/server-context.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

async function setup() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(McpResources)
  return ctx
}

const cfg = (serverName: string) => ({ serverName, transport: 'stdio' as const })
const statusStub = {
  status: () => ({ state: 'connecting' as const, attempt: 1 }),
  tools: () => [],
  serverInfo: () => undefined,
  subscribe: () => () => {},
  retry: () => 'busy' as const,
}

describe('MCP server context', () => {
  it('publishes literal instructions and withdraws the prompt and resource provider together', async () => {
    const ctx = await setup()
    let instructions = 'MCP server: docs\nKeep {{server.template}} literal.'
    const fiber = await ctx.plugin({ apply(inner: Context) {
      registerServerContext(inner, cfg('docs'), {
        resources: { request: async () => ({ resources: [] }) },
        instructions: () => instructions,
        ...statusStub,
      }, undefined)
    } })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(instructions)
    instructions = 'MCP server: docs\nUpdated instructions.'
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(instructions)
    await fiber.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('MCP server: docs')
    const result = await ctx.tools.execute({
      name: 'list_mcp_resources', arguments: { server: 'docs' },
      callId: ToolCallId('disposed-resource'), signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
  })

  it('shows scoped server instructions only to the owning scope', async () => {
    const ctx = await setup()
    const scopeKey = {}
    await ctx.plugin({ apply(inner: Context) {
      const scoped = createScope(inner, scopeKey)
      registerServerContext(scoped.ctx, cfg('private'), {
        resources: { request: async () => ({ resources: [] }) },
        instructions: () => 'Private server instructions.',
        ...statusStub,
      }, undefined)
    } })
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeKey }))).toContain('Private server instructions.')
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('Private server instructions.')
  })

  it('registers the connection status provider and releases it with the plugin', async () => {
    const ctx = await setup()
    const calls: { entryId: string | undefined; provider: McpServerStatusProvider }[] = []
    let disposed = 0
    class FakeMcpServers extends Service implements McpServerRegistration {
      constructor(c: Context) { super(c, 'mcpServers') }
      register(entryId: string | undefined, provider: McpServerStatusProvider): () => void {
        calls.push({ entryId, provider })
        // Like the real service: the registration is an effect of the registering fiber.
        const dispose = this.ctx.effect(() => () => { disposed += 1 }, 'fake-mcp-servers.register')
        return () => { void dispose() }
      }
    }
    await ctx.plugin(FakeMcpServers)
    const listener = () => {}
    const calledWith: string[] = []
    const info = { name: 'docs-server', version: '1.0.0' }
    const tool = { rawName: 'a', publicName: 'mcp__docs__a', description: '' }
    const fiber = await ctx.plugin({ apply(inner: Context) {
      registerServerContext(inner, cfg('docs'), {
        resources: { request: async () => ({ resources: [] }) },
        instructions: () => '',
        status: () => ({ state: 'connected', since: 7 }),
        tools: () => [tool],
        serverInfo: () => info,
        subscribe: (l) => { calledWith.push(l === listener ? 'listener' : 'other'); return () => { calledWith.push('unsubscribed') } },
        retry: () => 'started',
      }, 'entry-1')
    } })
    expect(calls).toHaveLength(1)
    const { entryId, provider } = calls[0]!
    expect(entryId).toBe('entry-1')
    expect(provider.serverName).toBe('docs')
    expect(provider.transport).toBe('stdio')
    expect(provider.status()).toEqual({ state: 'connected', since: 7 })
    expect(provider.tools()).toEqual([tool])
    expect(provider.serverInfo()).toBe(info)
    provider.subscribe(listener)()
    expect(calledWith).toEqual(['listener', 'unsubscribed'])
    expect(provider.retry()).toBe('started')
    expect(disposed).toBe(0)
    await fiber.dispose()
    expect(disposed).toBe(1)
  })

  it('does nothing when no mcpServers service is provided', async () => {
    const ctx = await setup()
    await expect(ctx.plugin({ apply(inner: Context) {
      registerServerContext(inner, cfg('docs'), {
        resources: { request: async () => ({ resources: [] }) },
        instructions: () => '',
        ...statusStub,
      }, undefined)
    } })).resolves.toBeDefined()
  })
})
