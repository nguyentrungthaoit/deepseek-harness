/** Profile patch transforms keep user-authored syntax and target the right rows. */
import { expect, it } from 'vitest'
import { parseDocument } from 'yaml'
import type { Document, YAMLSeq } from 'yaml'
import {
  MCP_CLIENT, allocatePatchId, findInsertedRow, insertServerRow, removeServerRow, replaceServerConfig,
} from '../src/patch.ts'

function parse(text: string): { document: Document.Parsed; items: YAMLSeq['items'] } {
  const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
  return { document, items: (document.contents as YAMLSeq).items }
}

const MULTI = `# keep me
- insert:
    - id: a
      name: '${MCP_CLIENT}'
      config:
        url: old
        stale: 1
      disabled: true
    - id: b
      name: other
      config:
        value: !!js process.platform
- not: a map
- 7
- insert: nope
- id: a
  disabled: true
- id: a
  name: '${MCP_CLIENT}'
  config:
    url: layer
- id: z
`

it('inserts into an empty document and keeps comments', () => {
  const empty = parse('[]\n')
  insertServerRow(empty.document, 'mcp-x', MCP_CLIENT, { url: 'http://x' })
  expect(String(empty.document)).toContain('id: mcp-x')
  expect(String(empty.document)).toContain(MCP_CLIENT)
  const commented = parse('# note\n- id: q\n')
  insertServerRow(commented.document, 'mcp-x', MCP_CLIENT, { url: 'http://x' })
  expect(String(commented.document)).toContain('# note')
  expect(String(commented.document)).toContain('url: http://x')
})

it('finds inserted rows', () => {
  const { document, items } = parse(MULTI)
  expect(findInsertedRow(document, items, 'b')).toEqual({ row: 0, element: 1 })
  expect(findInsertedRow(document, items, 'missing')).toBeUndefined()
  expect(findInsertedRow(document, items, 'z')).toBeUndefined()
})

it('replaces a profile element config in place', () => {
  const { document, items } = parse(MULTI)
  replaceServerConfig(document, items, 'a', MCP_CLIENT, { url: 'new' }, 'profile')
  const text = String(document)
  expect(text).toContain('# keep me')
  expect(text).toContain('url: new')
  expect(text).not.toContain('stale')
  expect(text).toContain('disabled: true')
  expect(text).toContain('value: !!js process.platform')
  expect(() => { replaceServerConfig(document, items, 'nope', MCP_CLIENT, {}, 'profile') }).toThrow('not inserted')
})

it('replaces layer configs on name-qualified and name-less overrides, or appends', () => {
  const qualified = parse(MULTI)
  replaceServerConfig(qualified.document, qualified.items, 'a', MCP_CLIENT, { url: 'n' }, 'layer')
  expect(String(qualified.document)).toContain('url: n')
  expect(String(qualified.document)).not.toContain('url: layer')
  const bare = parse('- id: a\n  disabled: true\n- id: a\n  name: other\n')
  replaceServerConfig(bare.document, bare.items, 'a', MCP_CLIENT, { url: 'n' }, 'layer')
  expect(String(bare.document)).toBe('- id: a\n  disabled: true\n  config:\n    url: n\n- id: a\n  name: other\n')
  const appended = parse('- id: a\n  name: other\n')
  replaceServerConfig(appended.document, appended.items, 'a', MCP_CLIENT, { url: 'n' }, 'layer')
  expect(String(appended.document)).toContain(`name: "${MCP_CLIENT}"`)
  expect(appended.items).toHaveLength(2)
})

it('removes one of two elements and keeps the row', () => {
  const { document, items } = parse(MULTI)
  removeServerRow(document, items, 'b')
  const text = String(document)
  expect(text).not.toContain('id: b')
  expect(text).toContain('id: a')
  expect(text).toContain('# keep me')
})

it('removes the row and overrides when the last element goes', () => {
  const { document, items } = parse(MULTI)
  removeServerRow(document, items, 'b')
  removeServerRow(document, items, 'a')
  const text = String(document)
  expect(text).not.toContain('id: a')
  expect(text).not.toContain('layer')
  expect(text).toContain('id: z')
  expect(items).toHaveLength(4)
})

it('rejects removing an id the profile does not insert', () => {
  const { document, items } = parse(MULTI)
  expect(() => { removeServerRow(document, items, 'missing') }).toThrow('not inserted')
})

it('allocates unique patch ids', () => {
  expect(allocatePatchId('fs', new Set())).toBe('mcp-fs')
  expect(allocatePatchId('fs', new Set(['mcp-fs']))).toBe('mcp-fs-2')
  expect(allocatePatchId('fs', new Set(['mcp-fs', 'mcp-fs-2']))).toBe('mcp-fs-3')
})
