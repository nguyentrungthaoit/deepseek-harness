/** DOCX extraction keeps paragraph and table text, drops images, and stops at the character cap. */
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

const OPEN = { maxExtractedChars: 10_000 }

it('returns paragraph lines and tab-separated table rows without HTML or images', async () => {
  const result = await extractDocx(sampleDocx(), OPEN, new AbortController().signal)
  expect(result).toEqual({ text: TEXT })
  expect(result.text).not.toMatch(/<\/?[a-z]/)
  expect(result.text).not.toContain('PICTURE_ALT')
  expect(result.text).not.toContain('iVBOR')
})

it('reads a byte view of the same package', async () => {
  const bytes = sampleDocx()
  const padded = new Uint8Array(bytes.length + 4)
  padded.set(bytes, 4)
  const view = padded.subarray(4)
  expect(view.byteOffset).not.toBe(0)
  expect(await extractDocx(view, OPEN, new AbortController().signal)).toEqual({ text: TEXT })
})

it('cuts text at the character cap and reports it, but not at an exact fit', async () => {
  const signal = new AbortController().signal
  expect(await extractDocx(sampleDocx(), { maxExtractedChars: TEXT.length }, signal)).toEqual({ text: TEXT })
  expect(await extractDocx(sampleDocx(), { maxExtractedChars: TEXT.length - 1 }, signal))
    .toEqual({ text: TEXT.slice(0, -1), capped: ['chars'] })
  expect(await extractDocx(sampleDocx(), { maxExtractedChars: 7 }, signal)).toEqual({ text: 'Hello &', capped: ['chars'] })
})

it('rejects an aborted signal and bytes that are not a DOCX package', async () => {
  const reason = new Error('stopped')
  await expect(extractDocx(sampleDocx(), OPEN, AbortSignal.abort(reason))).rejects.toBe(reason)
  const controller = new AbortController()
  const pending = extractDocx(sampleDocx(), OPEN, controller.signal)
  controller.abort(reason)
  await expect(pending).rejects.toBe(reason)
  await expect(extractDocx(Uint8Array.of(1, 2, 3, 4), OPEN, new AbortController().signal)).rejects.toThrow()
})

it('rejects with an AbortError for a non-Error reason, even when conversion fails afterwards', async () => {
  const controller = new AbortController()
  const pending = extractDocx(Uint8Array.of(1, 2, 3, 4), OPEN, controller.signal)
  controller.abort('stop')
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await new Promise((resolve) => { setTimeout(resolve, 20) })
})
