/** Profile saves share the writer lock with Plugin Manager and take it before the HMR queue. */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { configurationFixture } from './configuration-fixture.ts'

/** Hold the profile writer lock as another writer in this process would, until the returned release runs. */
function holdProfileLock(dir: string): () => void {
  const lock = join(dir, 'package.json.lock')
  writeFileSync(lock, `${process.pid}\n`, { flag: 'wx' })
  return () => { rmSync(lock) }
}

it('waits for a writer that holds the profile lock while it takes the HMR queue', async () => {
  const { ctx, profile } = await configurationFixture()
  const release = holdProfileLock(profile.dir)
  const saving = ctx.configEditor.rewrite((document) => {
    document.add(document.createNode({ id: 'second', disabled: true }))
    return []
  })
  await delay(50)
  // Plugin Manager's order: the profile lock first, then the HMR queue, which a save must not already hold.
  await ctx.hmr.runExclusive(async () => {})
  release()
  await saving
  expect(readFileSync(profile.patchPath, 'utf8')).toContain('disabled: true')
})

it('fails a save after the configured lock wait', async () => {
  const { ctx, profile } = await configurationFixture({ hmr: false })
  const editor = [...ctx.loader.entries()].find(entry => entry.options.id === 'config-editor')!
  await editor.update({ config: { lockWaitMs: 50 } })
  await ctx.loader.await()
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'first')!
  const before = readFileSync(profile.patchPath, 'utf8')
  const release = holdProfileLock(profile.dir)
  try {
    await expect(ctx.configEditor.edit(entry, raw => ({ ...raw, count: 6 }))).rejects.toThrow('timed out waiting for the writer lock')
  } finally {
    release()
  }
  expect(readFileSync(profile.patchPath, 'utf8')).toBe(before)
})

it('waits longer than the file-lock default for a slow writer', async () => {
  const { ctx, profile } = await configurationFixture({ hmr: false })
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'first')!
  const release = holdProfileLock(profile.dir)
  const saving = ctx.configEditor.edit(entry, raw => ({ ...raw, count: 6 }))
  await delay(2_300)
  release()
  await saving
  expect(readFileSync(profile.patchPath, 'utf8')).toContain('count: 6')
}, 10_000)
