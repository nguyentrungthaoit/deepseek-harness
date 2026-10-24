/**
 * Publish connection-owned MCP resources and literal server instructions.
 *
 * @module @deepseek-ai/dsh-mcp-client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './index.ts'
import type { McpResourceProvider } from '@deepseek-ai/dsh-mcp-resources'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { McpServerStatusProvider } from '@deepseek-ai/dsh-mcp-manager/types'

/** Connection-owned values used by the resource, prompt, and status consumers. */
export interface ServerContext extends Omit<McpServerStatusProvider, 'serverName' | 'transport'> {
  /** Resource access through the current connection generation. */
  resources: McpResourceProvider
  /**
   * Read the last successfully connected server's attributed instructions.
   * @returns literal prompt text, or an empty string when no server instructions are active.
   */
  instructions(): string
}

/**
 * Contribute server context to the services enabled by this composition.
 * @param ctx - server plugin's registration scope and effect owner.
 * @param config - configured server identity and transport.
 * @param connection - live resource operations, instruction snapshot, and status.
 * @param entryId - raw Loader entry id of the owning plugin, when it has one.
 */
export function registerServerContext(
  ctx: Context,
  config: Pick<Config, 'serverName' | 'transport'>,
  connection: ServerContext,
  entryId: string | undefined,
): void {
  const server = config.serverName
  ctx.inject(['mcpResources'], (inner) => {
    inner.mcpResources.register(server, connection.resources)
  })
  ctx.inject(['systemPrompt'], (inner) => {
    inner.systemPrompt.section({
      name: `mcp:${server}`,
      order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
      interpolate: false,
      text: () => connection.instructions(),
    })
  })
  ctx.inject(['mcpServers'], (inner) => {
    inner.mcpServers.register(entryId, {
      serverName: server,
      transport: config.transport,
      status: () => connection.status(),
      tools: () => connection.tools(),
      serverInfo: () => connection.serverInfo(),
      subscribe: listener => connection.subscribe(listener),
      retry: () => connection.retry(),
    })
  })
}
