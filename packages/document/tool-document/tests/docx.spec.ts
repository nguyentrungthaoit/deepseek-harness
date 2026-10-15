/** DOCX extraction keeps paragraph and table text and drops images. */
import { expect, it } from 'vitest'
import { extractDocx } from '../src/docx.ts'
import { sampleDocx } from './fixtures/docx.ts'

const TEXT = [
  'Hello & world',
  'a < b',
  'Bold line',
  'tab\there',
  'A\tB',
  'C\t\tE',
  'Before after',
].join('\n')

it('returns paragraph lines and tab-separated table rows without HTML or images', async () => {
  const text = await extractDocx(sampleDocx(), new AbortController().signal)
  expect(text).toBe(TEXT)
  expect(text).not.toMatch(/<\/?[a-z]/)
  expect(text).not.toContain('PICTURE_ALT')
  expect(text).not.toContain('iVBOR')
})

it('reads a byte view of the same package', async () => {
  const bytes = sampleDocx()
  const padded = new Uint8Array(bytes.length + 4)
  padded.set(bytes, 4)
  const view = padded.subarray(4)
  expect(view.byteOffset).not.toBe(0)
  expect(await extractDocx(view, new AbortController().signal)).toBe(TEXT)
})

it('rejects an aborted signal and bytes that are not a DOCX package', async () => {
  const reason = new Error('stopped')
  await expect(extractDocx(sampleDocx(), AbortSignal.abort(reason))).rejects.toBe(reason)
  const controller = new AbortController()
  const pending = extractDocx(sampleDocx(), controller.signal)
  controller.abort(reason)
  await expect(pending).rejects.toBe(reason)
  await expect(extractDocx(Uint8Array.of(1, 2, 3, 4), new AbortController().signal)).rejects.toThrow()
})
