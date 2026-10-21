/** Child argv and stdout JSON. */
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { childArgv, parseChildOutput } from '../src/child.ts'
import type { ChildRequest } from '../src/extract.ts'

const REQUEST: ChildRequest = {
  format: 'pdf',
  maxPages: 2,
  maxExtractedChars: 20,
  maxSheets: 1,
  maxRowsPerSheet: 1,
}

describe('childArgv', () => {
  it('loads the TypeScript worker through tsx, caps the heap, and keeps the path out of argv', () => {
    const moduleUrl = pathToFileURL('D:/pkg/src/child.ts').href
    const argv = childArgv(moduleUrl, 'node', () => 'tsx/esm', REQUEST, 1024)
    expect(argv.slice(0, 4)).toEqual(['node', '--max-old-space-size=1024', '--import', 'tsx/esm'])
    expect(argv[4]).toMatch(/worker\.ts$/)
    expect(argv[5]).toBe(JSON.stringify(REQUEST))
    expect(argv.join(' ')).not.toContain('report.pdf')
  })

  it('runs the built worker without resolving the tsx loader', () => {
    const moduleUrl = pathToFileURL('D:/pkg/lib/child.js').href
    const argv = childArgv(moduleUrl, 'node', () => { throw new Error('tsx must not be resolved') }, REQUEST, 256)
    expect(argv).toEqual(['node', '--max-old-space-size=256', expect.stringMatching(/worker\.js$/), JSON.stringify(REQUEST)])
    expect(argv).not.toContain('--import')
  })
})

describe('parseChildOutput', () => {
  it('reads text, an optional notice, caps, and their counts', () => {
    expect(parseChildOutput('{"text":"Hello"}')).toEqual({ text: 'Hello' })
    expect(parseChildOutput('{"text":"","notice":"no text layer"}')).toEqual({ text: '', notice: 'no text layer' })
    expect(parseChildOutput(JSON.stringify({
      text: 'x',
      capped: ['pages', 'sheets', 'rows', 'chars'],
      pageCount: 3,
      sheetCount: 4,
      rowsSheet: 'Data',
    }))).toEqual({
      text: 'x',
      capped: ['pages', 'sheets', 'rows', 'chars'],
      pageCount: 3,
      sheetCount: 4,
      rowsSheet: 'Data',
    })
    expect(parseChildOutput('{"text":"x","capped":["rows","chars"]}')).toEqual({ text: 'x', capped: ['rows', 'chars'] })
  })

  it('rejects stdout that is not the child result', () => {
    expect(() => parseChildOutput('not-json')).toThrow(/invalid JSON/)
    expect(() => parseChildOutput('null')).toThrow(/unexpected result/)
    expect(() => parseChildOutput('{"truncated":true}')).toThrow(/unexpected result/)
    expect(() => parseChildOutput('{"text":"Hello","notice":1}')).toThrow(/unexpected result/)
    expect(() => parseChildOutput('{"text":"x","pageCount":"3"}')).toThrow(/unexpected result/)
    expect(() => parseChildOutput('{"text":"x","rowsSheet":3}')).toThrow(/unexpected result/)
  })

  it('rejects unknown, duplicate, out-of-order, empty, and non-array caps', () => {
    for (const capped of [['lines'], ['chars', 'chars'], ['chars', 'pages'], [], 'chars', [1]]) {
      expect(() => parseChildOutput(JSON.stringify({ text: 'x', capped }))).toThrow(/unexpected result/)
    }
  })
})
