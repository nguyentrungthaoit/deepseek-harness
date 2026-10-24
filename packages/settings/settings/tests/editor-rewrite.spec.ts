/** Rewriting the profile patch inserts and removes rows, and rolls back what cannot activate. */
import * as fs from 'node:fs/promises'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { isMap } from 'yaml'
import { configurationFixture } from './configuration-fixture.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, readFile: vi.fn(original.readFile) }
})
afterEach(() => { vi.mocked(fs.readFile).mockReset() })

const third = { id: 'third', name: 'cordis:probe', config: { ordinary: { __jsExpr: '"computed"' } } }

it('inserts a computed row, keeping comments and writing a !!js tag', async () => {
  const { ctx, profile } = await configurationFixture({ hmr: false })
  writeFileSync(profile.patchPath, '# keep this note\n[]\n')
  const warnings = await ctx.configEditor.rewrite((document, items) => {
    items.push(document.createNode({ insert: [third] }))
    return ['third']
  })
  expect(warnings).toEqual([])
  const text = readFileSync(profile.patchPath, 'utf8')
  expect(text).toContain('# keep this note')
  expect(text).toContain('!!js')
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'third')
  expect(entry?.options.config).toBeDefined()
  expect((entry!.fiber!.config as { ordinary: string }).ordinary).toBe('computed')
})

it('removes a previously inserted row from the entries and the file', async () => {
  const { ctx, profile } = await configurationFixture({ hmr: false })
  await ctx.configEditor.rewrite((document, items) => {
    items.push(document.createNode({ insert: [{ id: 'third', name: 'cordis:probe', config: { ordinary: 'plain' } }] }))
    return ['third']
  })
  expect(ctx.configEditor.entries().some(row => row.options.id === 'third')).toBe(true)
  await ctx.configEditor.rewrite((document, items) => {
    const index = items.findIndex(item => isMap(item) && item.has('insert'))
    document.delete(index)
    return []
  })
  expect(ctx.configEditor.entries().some(row => row.options.id === 'third')).toBe(false)
  expect(readFileSync(profile.patchPath, 'utf8')).not.toContain('third')
})

it('restores the file when a required inserted row is invalid', async () => {
  const { ctx, profile } = await configurationFixture({ hmr: false })
  const before = readFileSync(profile.patchPath, 'utf8')
  await expect(ctx.configEditor.rewrite((document, items) => {
    items.push(document.createNode({ insert: [{ id: 'third', name: 'cordis:probe', config: {} }] }))
    return ['third']
  })).rejects.toThrow()
  expect(readFileSync(profile.patchPath, 'utf8')).toBe(before)
  expect(ctx.configEditor.entries().some(row => row.options.id === 'third')).toBe(false)
})

it('persists a disabled row without hot module reload', async () => {
  const { ctx, profile } = await configurationFixture({ hmr: false })
  await ctx.configEditor.rewrite((document, items) => {
    items.push(document.createNode({ id: 'second', disabled: true }))
    return []
  })
  const text = readFileSync(profile.patchPath, 'utf8')
  expect(text).toContain('id: second')
  expect(text).toContain('disabled: true')
})

it('creates a missing patch file', async () => {
  const { ctx, profile } = await configurationFixture({ hmr: false })
  rmSync(profile.patchPath)
  await ctx.configEditor.rewrite((document, items) => {
    items.push(document.createNode({ id: 'second', disabled: true }))
    return []
  })
  expect(existsSync(profile.patchPath)).toBe(true)
  expect(readFileSync(profile.patchPath, 'utf8')).toContain('id: second')
})

it('refuses a patch document that is not a sequence', async () => {
  const { ctx, profile } = await configurationFixture({ hmr: false })
  const before = readFileSync(profile.patchPath, 'utf8')
  // The Loader synchronizes the real file first; the document read afterwards observes a mapping.
  vi.mocked(fs.readFile).mockResolvedValueOnce('{}')
  await expect(ctx.configEditor.rewrite(() => [])).rejects.toThrow('Profile patch must be a YAML sequence')
  expect(readFileSync(profile.patchPath, 'utf8')).toBe(before)
})
