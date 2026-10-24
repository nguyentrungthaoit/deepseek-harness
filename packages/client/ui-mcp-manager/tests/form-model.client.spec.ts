/** The MCP form keeps untouched stored values and sends only what the user edited. */
import { describe, expect, it } from 'vitest'
import type { McpServerView } from '@deepseek-ai/dsh-mcp-manager/types'
import { edit, initialForm, problem, toDraft } from '../src/client/form-model.ts'

function view(config: McpServerView['config'], secrets: McpServerView['secrets'] = []): McpServerView {
  return {
    entryId: 'include:mcp-x' as McpServerView['entryId'], patchId: 'mcp-x', serverName: config.serverName,
    transport: config.transport, enabled: true, ownership: 'profile', config, secrets,
    status: { state: 'connected', since: 1 }, tools: [],
  }
}

describe('a new row', () => {
  it('starts empty and needs a valid name and command', () => {
    const state = initialForm()
    expect(state).toMatchObject({ transport: 'stdio', serverName: '', secrets: [], reconnectBase: {} })
    expect(problem(state)).toBe('form.serverNameHint')
    expect(problem({ ...state, serverName: 'docs' })).toBe('form.command')
    expect(problem({ ...state, serverName: 'docs', transport: 'streamable-http' })).toBe('form.url')
  })

  it('sends only edited stdio fields and new secrets', () => {
    const start = initialForm()
    const state = {
      ...start, serverName: ' docs ',
      command: edit(start.command, ' npx '), args: edit(start.args, '-y\n\n server '),
      cwd: edit(start.cwd, '   '), toolCallTimeoutMs: edit(start.toolCallTimeoutMs, '5000'),
      failOnStartupError: edit(start.failOnStartupError, true), reconnectEnabled: edit(start.reconnectEnabled, false),
      secrets: [{ key: ' TOKEN ', stored: false, value: 's3cret' }, { key: '', stored: false, value: 'x' }, { key: 'EMPTY', stored: false, value: '' }],
    }
    expect(problem(state)).toBeUndefined()
    expect(toDraft(state)).toEqual({
      transport: 'stdio', serverName: 'docs', command: 'npx', args: ['-y', 'server'],
      toolCallTimeoutMs: 5000, failOnStartupError: true, reconnect: { enabled: false }, env: { TOKEN: { value: 's3cret' } },
    })
  })

  it('omits an unparsable timeout and empty secrets for Streamable HTTP', () => {
    const start = initialForm()
    const state = { ...start, transport: 'streamable-http' as const, serverName: 'remote', url: edit(start.url, 'https://x'), toolCallTimeoutMs: edit(start.toolCallTimeoutMs, 'soon') }
    expect(toDraft(state)).toEqual({ transport: 'streamable-http', serverName: 'remote', url: 'https://x' })
  })
})

describe('an existing row', () => {
  const stdio = view(
    {
      transport: 'stdio', serverName: 'docs', command: 'npx', args: ['-y', 'server'], cwd: { expression: 'process.cwd()' },
      toolCallTimeoutMs: 9000, failOnStartupError: false, reconnect: { enabled: true, maxAttempts: 4 },
    },
    [{ path: ['env', 'TOKEN'], set: true }, { path: ['headers', 'X'], set: true }, { path: ['env'], set: false }],
  )

  it('shows stored values and expressions and lists only this transport secrets', () => {
    const state = initialForm(stdio)
    expect(state.args.value).toBe('-y\nserver')
    expect(state.cwd).toEqual({ value: '', stored: true, expression: 'process.cwd()', dirty: false })
    expect(state.secrets).toEqual([{ key: 'TOKEN', stored: true, value: '' }])
    expect(state.reconnectBase).toEqual({ enabled: true, maxAttempts: 4 })
    expect(problem(state)).toBeUndefined()
  })

  it('keeps every untouched field and stored secret', () => {
    expect(toDraft(initialForm(stdio))).toEqual({
      transport: 'stdio', serverName: 'docs', command: { keep: true }, args: { keep: true }, cwd: { keep: true },
      toolCallTimeoutMs: { keep: true }, failOnStartupError: { keep: true }, reconnect: { keep: true }, env: { TOKEN: { keep: true } },
    })
  })

  it('replaces an expression and a secret and keeps other reconnect keys', () => {
    const start = initialForm(stdio)
    const state = {
      ...start, cwd: edit(start.cwd, '/srv'), reconnectEnabled: edit(start.reconnectEnabled, false),
      secrets: [{ key: 'TOKEN', stored: true, value: 'rotated' }],
    }
    expect(toDraft(state)).toMatchObject({ cwd: '/srv', reconnect: { enabled: false, maxAttempts: 4 }, env: { TOKEN: { value: 'rotated' } } })
  })

  it('defaults the reconnect switch on when the stored policy leaves it unset', () => {
    const policy = view({ transport: 'stdio', serverName: 'p', command: 'c', reconnect: { maxAttempts: 2 } })
    expect(initialForm(policy).reconnectEnabled).toMatchObject({ value: true, stored: true })
  })

  it('refuses a cleared required field', () => {
    const start = initialForm(stdio)
    expect(problem({ ...start, command: edit(start.command, ' ') })).toBe('form.command')
  })

  it('reads Streamable HTTP rows and stored expressions for the reconnect policy', () => {
    const http = view({ transport: 'streamable-http', serverName: 'remote', url: 'https://x', reconnect: { expression: 'policy()' } }, [{ path: ['headers', 'Authorization'], set: true }])
    const state = initialForm(http)
    expect(state).toMatchObject({ transport: 'streamable-http', url: { value: 'https://x', stored: true }, reconnectBase: {} })
    expect(state.reconnectEnabled).toMatchObject({ stored: true, expression: 'policy()' })
    expect(toDraft(state)).toEqual({ transport: 'streamable-http', serverName: 'remote', url: { keep: true }, reconnect: { keep: true }, headers: { Authorization: { keep: true } } })
  })
})
