/** Shared fixtures for the MCP panel component specs. */
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { McpServerId, McpServerView, McpToolView } from '@deepseek-ai/dsh-mcp-manager/types'
import { en } from '../src/client/locales.ts'

export const t = makeTranslate(en) as never

export const SECRET = 'sk-super-secret-value'

/**
 * Brand a raw id as the wire entry id.
 * @param value - the raw Loader entry id.
 * @returns the branded id.
 */
export function entryId(value: string): McpServerId {
  return value as McpServerId
}

/**
 * Build a discovered tool.
 * @param name - the public name.
 * @param extra - fields overriding the defaults.
 * @returns the tool view.
 */
export function tool(name: string, extra: Partial<McpToolView> = {}): McpToolView {
  return { rawName: name, publicName: name, description: '', ...extra }
}

/**
 * Build a server row, defaulting to a connected stdio profile row.
 * @param overrides - fields replacing the defaults.
 * @returns the row.
 */
export function view(overrides: Partial<McpServerView> = {}): McpServerView {
  return {
    entryId: entryId('e1'), serverName: 'files', transport: 'stdio', enabled: true, ownership: 'profile',
    config: { serverName: 'files', transport: 'stdio', command: 'node' },
    secrets: [], status: { state: 'connected', since: 0 }, tools: [],
    ...overrides,
  }
}
