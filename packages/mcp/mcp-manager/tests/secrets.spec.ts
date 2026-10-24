/** Stored MCP rows reach the browser without secret values, and drafts keep or replace them. */
import { describe, expect, it } from 'vitest'
import type z from '@deepseek-ai/schemastery'
import { redactSecrets } from '@deepseek-ai/dsh-settings'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { Config } from '@deepseek-ai/dsh-mcp-client'
import { MASK, SECRET_FIELDS, maskConfig, mergeDraft, scrub, secretValues } from '../src/secrets.ts'
import type { McpServerDraft } from '../src/types.ts'

const stdio = {
  transport: 'stdio', serverName: 'memory', command: 'npx', args: ['-y', 'server'], cwd: { __jsExpr: 'process.cwd()' },
  env: { TOKEN: 'secret-token', COMPUTED: { __jsExpr: 'process.env.X' } }, reconnect: { maxAttempts: 3 },
}
const http = { transport: 'streamable-http', serverName: 'remote', url: 'https://mcp.test/mcp', headers: { Authorization: 'Bearer abc123' } }

function failure(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected a failure')
}

describe('maskConfig', () => {
  it('declares the same secret positions as the client Config', () => {
    for (const sample of [stdio, http]) {
      expect(redactSecrets(SECRET_FIELDS as z<never>, sample).secrets).toEqual(redactSecrets(Config as z<never>, sample).secrets)
    }
  })

  it('projects a stdio row without secret values and keeps expressions as source', () => {
    const { config, secrets } = maskConfig(stdio, 'memory')
    expect(config).toEqual({
      transport: 'stdio', serverName: 'memory', command: 'npx', args: ['-y', 'server'],
      cwd: { expression: 'process.cwd()' }, reconnect: { maxAttempts: 3 },
    })
    expect(secrets).toEqual([{ path: ['env', 'TOKEN'], set: true }, { path: ['env', 'COMPUTED'], set: true }])
    expect(JSON.stringify(config)).not.toContain('secret-token')
  })

  it('projects a Streamable HTTP row', () => {
    const { config, secrets } = maskConfig(http, 'remote')
    expect(config).toEqual({ transport: 'streamable-http', serverName: 'remote', url: 'https://mcp.test/mcp' })
    expect(secrets).toEqual([{ path: ['headers', 'Authorization'], set: true }])
  })
})

describe('mergeDraft', () => {
  it('keeps stored values and expressions, writes new ones, and drops omitted secrets', () => {
    const draft: McpServerDraft = {
      transport: 'stdio', serverName: 'memory', command: { keep: true }, cwd: { keep: true }, args: ['--fast'],
      env: { TOKEN: { keep: true }, NEW: { value: 'fresh' } }, toolCallTimeoutMs: 5_000, failOnStartupError: true,
      reconnect: { enabled: false },
    }
    expect(mergeDraft(draft, stdio)).toEqual({
      transport: 'stdio', serverName: 'memory', command: 'npx', cwd: { __jsExpr: 'process.cwd()' }, args: ['--fast'],
      env: { TOKEN: 'secret-token', NEW: 'fresh' }, toolCallTimeoutMs: 5_000, failOnStartupError: true, reconnect: { enabled: false },
    })
  })

  it('builds a new Streamable HTTP row', () => {
    expect(mergeDraft({ transport: 'streamable-http', serverName: 'r', url: 'https://x', headers: { A: { value: 'b' } } }, {}))
      .toEqual({ transport: 'streamable-http', serverName: 'r', url: 'https://x', headers: { A: 'b' } })
    expect(mergeDraft({ transport: 'streamable-http', serverName: 'r', url: 'https://x' }, {}))
      .toEqual({ transport: 'streamable-http', serverName: 'r', url: 'https://x' })
  })

  it.each([
    ['a non-object draft', 'oops', {}],
    ['a missing serverName', { transport: 'stdio', command: 'c' }, {}],
    ['a missing command', { transport: 'stdio', serverName: 's' }, {}],
    ['a missing url', { transport: 'streamable-http', serverName: 's' }, {}],
    ['an unknown transport', { transport: 'ws', serverName: 's' }, {}],
    ['keeping an absent field', { transport: 'stdio', serverName: 's', command: { keep: true } }, {}],
    ['a wrongly typed field', { transport: 'stdio', serverName: 's', command: 'c', args: 'one' }, {}],
    ['an invalid reconnect key', { transport: 'stdio', serverName: 's', command: 'c', reconnect: { jitter: 1 } }, {}],
    ['a non-numeric reconnect delay', { transport: 'stdio', serverName: 's', command: 'c', reconnect: { maxDelayMs: 'x' } }, {}],
    ['a non-object secret map', { transport: 'stdio', serverName: 's', command: 'c', env: 'x' }, {}],
    ['keeping an absent secret', { transport: 'stdio', serverName: 's', command: 'c', env: { K: { keep: true } } }, {}],
    ['a malformed secret entry', { transport: 'streamable-http', serverName: 's', url: 'u', headers: { K: 'raw' } }, {}],
  ] as const)('refuses %s', (_name, draft, stored) => {
    expect(remoteErrorOf(failure(() => mergeDraft(draft as never, stored)))).toMatchObject({ code: 'gateway/bad-request' })
  })
})

describe('scrub', () => {
  it('masks stored literals and resolved expression values, longest first', () => {
    const values = secretValues(stdio, { env: { TOKEN: 'secret-token', COMPUTED: 'computed-secret', SHORT: 'abc' } })
    expect(values).toEqual(['computed-secret', 'secret-token'])
    expect(scrub('auth failed for secret-token and computed-secret', values)).toBe(`auth failed for ${MASK} and ${MASK}`)
  })

  it('collects header values without a live config', () => {
    expect(secretValues(http, undefined)).toEqual(['Bearer abc123'])
    expect(secretValues({ env: 'not-a-map' }, undefined)).toEqual([])
  })
})
