/** Ownership of composed plugin entries by profile patch rows, through a real booted Loader tree. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { boot } from '../src/index.ts'
import { flattenEntries, resolveEntryOwnership } from '../src/ownership.ts'

const tempRoots: string[] = []
afterAll(() => { for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true }) })

const NOOP_PLUGIN = 'export const name = "noop"\nexport function apply() {}\n'

/** Boot `cordis.yml` holding an include named `include`, whose file holds a plugin `top`; entry ids are path-like. */
async function bootTree(): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ownership-'))
  tempRoots.push(dir)
  writeFileSync(join(dir, 'noop.mjs'), NOOP_PLUGIN)
  writeFileSync(join(dir, 'outer.yml'), '- id: top\n  name: ./noop.mjs\n')
  writeFileSync(join(dir, 'cordis.yml'), "- id: include\n  name: 'cordis:include'\n  config:\n    path: ./outer.yml\n")
  return await boot('dsh-ownership', join(dir, 'cordis.yml'))
}

/** A composed row naming the plugin module. */
function row(id: string, name: string): EntryOptions { return { id, name } }

describe('flattenEntries', () => {
  it('lists a native group followed by its nested rows and ignores non-group configs', () => {
    const nested = row('child', 'child-module')
    const group: EntryOptions = { id: 'g', name: 'cordis:group', group: true, config: [nested] }
    const plain: EntryOptions = { id: 'p', name: 'plain', config: [row('ignored', 'x')] }
    const notList: EntryOptions = { id: 'n', name: 'n', group: true, config: { not: 'a list' } }
    expect(flattenEntries([group, plain, notList]).map(item => item.id)).toEqual(['g', 'child', 'p', 'n'])
  })
})

describe('resolveEntryOwnership', () => {
  it('classifies every ownership outcome', async () => {
    const ctx = await bootTree()
    try {
      const included = 'include:include'
      const nested = 'include:include:top'
      const options = { protectedModules: new Set(['protected-module']), ownerEntryId: 'owner' }
      const classify = (entryId: string, moduleName: string, rows: EntryOptions[]) =>
        resolveEntryOwnership([{ entryId, moduleName, extra: 1 }], rows, ctx.loader.entries(), options)[0]
      const include = row('include', 'cordis:include')
      // Addressable: one row, same module name, parent include is the entry named `include`.
      expect(classify(included, 'cordis:include', [include])).toEqual(
        { entryId: included, moduleName: 'cordis:include', extra: 1, patchId: 'include' })
      expect(classify(included, 'protected-module', [include])).toMatchObject({ readOnlyReason: 'management-required' })
      expect(classify('owner', 'cordis:include', [include])).toMatchObject({ readOnlyReason: 'management-required' })
      expect(classify(included, 'cordis:include', [])).toMatchObject({ readOnlyReason: 'unaddressable' })
      expect(classify(included, 'cordis:include', [include, include])).toMatchObject({ readOnlyReason: 'unaddressable' })
      expect(classify(included, 'cordis:include', [row('include', 'renamed')])).toMatchObject({ readOnlyReason: 'unaddressable' })
      // Nested include: its parent entry is `include:include`, not `include`.
      expect(classify(nested, './noop.mjs', [row('top', './noop.mjs')])).toMatchObject({ readOnlyReason: 'unaddressable' })
      // Root entry: no parent include entry at all.
      expect(classify('include', 'cordis:include', [include])).toMatchObject({ readOnlyReason: 'unaddressable' })
      // No Loader entry with that id.
      expect(classify('ghost', 'cordis:include', [include])).toMatchObject({ readOnlyReason: 'unaddressable' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('treats an entry without a Loader counterpart as unaddressable when no owner is set', async () => {
    const ctx = await bootTree()
    try {
      const [only] = resolveEntryOwnership([{ entryId: 'include:include', moduleName: 'cordis:include' }], [], ctx.loader.entries(),
        { protectedModules: new Set() })
      expect(only).toMatchObject({ readOnlyReason: 'unaddressable' })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
