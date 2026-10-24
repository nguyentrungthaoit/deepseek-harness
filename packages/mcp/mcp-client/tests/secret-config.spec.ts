/** The mcp-client Config marks `env` and `headers` values as secrets, so settings redaction strips them. */
import { expect, it } from 'vitest'
import type z from '@deepseek-ai/schemastery'
import { redactSecrets } from '@deepseek-ai/dsh-settings'
import { Config } from '@deepseek-ai/dsh-mcp-client'

it('redacts env and headers values and reports their secret positions', () => {
  const stdio = redactSecrets(Config as z<never>, {
    transport: 'stdio', serverName: 's', command: 'c', env: { TOKEN: 'secret-value' },
  })
  expect((stdio.value as { env?: Record<string, string> }).env?.TOKEN).toBeUndefined()
  expect(stdio.secrets).toContainEqual({ path: ['env', 'TOKEN'], set: true })
  expect(JSON.stringify(stdio.value)).not.toContain('secret-value')

  const http = redactSecrets(Config as z<never>, {
    transport: 'streamable-http', serverName: 's', url: 'http://localhost/mcp', headers: { Authorization: 'secret-value' },
  })
  expect((http.value as { headers?: Record<string, string> }).headers?.Authorization).toBeUndefined()
  expect(http.secrets).toContainEqual({ path: ['headers', 'Authorization'], set: true })
  expect(JSON.stringify(http.value)).not.toContain('secret-value')
})
