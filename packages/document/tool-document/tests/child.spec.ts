/** Child argv, environment scrub, and stdout JSON. */
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { childArgv, parseChildOutput, scrubbedChildEnv } from '../src/child.ts'
import type { ChildRequest } from '../src/child.ts'

const REQUEST: ChildRequest = {
  format: 'pdf',
  maxPages: 2,
  maxExtractedChars: 20,
  maxSheets: 1,
  maxRowsPerSheet: 1,
}

describe('scrubbedChildEnv', () => {
  it('drops credential-shaped names and undefined values', () => {
    const env = scrubbedChildEnv({
      PLAIN_VALUE: 'kept',
      DOCUMENT_PROBE_KEY: 'secret',
      ALSO_SECRET: 'nope',
      API_TOKEN: 'nope',
      DB_PASSWORD: 'nope',
      EMPTY: undefined,
    })
    expect(env).toEqual({ PLAIN_VALUE: 'kept' })
    expect(JSON.stringify(env)).not.toContain('secret')
  })
})

describe('childArgv', () => {
  it('loads the TypeScript worker through tsx and keeps the path out of argv', () => {
    const moduleUrl = pathToFileURL('D:/pkg/src/child.ts').href
    const argv = childArgv(moduleUrl, 'node', 'tsx/esm', REQUEST)
    expect(argv.slice(0, 3)).toEqual(['node', '--import', 'tsx/esm'])
    expect(argv[3]).toMatch(/worker\.ts$/)
    expect(argv[4]).toBe(JSON.stringify(REQUEST))
    expect(argv.join(' ')).not.toContain('report.pdf')
  })

  it('runs the built worker without the tsx loader', () => {
    const moduleUrl = pathToFileURL('D:/pkg/lib/child.js').href
    const argv = childArgv(moduleUrl, 'node', 'tsx/esm', REQUEST)
    expect(argv).toEqual(['node', expect.stringMatching(/worker\.js$/), JSON.stringify(REQUEST)])
    expect(argv).not.toContain('--import')
  })
})

describe('parseChildOutput', () => {
  it('reads text and an optional notice', () => {
    expect(parseChildOutput('{"text":"Hello"}')).toEqual({ text: 'Hello' })
    expect(parseChildOutput('{"text":"","notice":"no text layer"}')).toEqual({ text: '', notice: 'no text layer' })
  })

  it('rejects stdout that is not the child result', () => {
    expect(() => parseChildOutput('not-json')).toThrow(/invalid JSON/)
    expect(() => parseChildOutput('null')).toThrow(/unexpected result/)
    expect(() => parseChildOutput('{"truncated":true}')).toThrow(/unexpected result/)
    expect(() => parseChildOutput('{"text":"Hello","notice":1}')).toThrow(/unexpected result/)
  })
})
