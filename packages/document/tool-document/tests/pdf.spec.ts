/** PDF text extraction returns text-layer lines and a notice when that layer is missing. */
import { describe, expect, it } from 'vitest'
import { extractPdf } from '../src/pdf.ts'
import { emptyTextPdf, textPdf } from './fixtures/pdf.ts'

const open = { maxPages: 10, maxExtractedChars: 10_000 }

describe('extractPdf', () => {
  it('returns text items and page markers when the PDF has a text layer', async () => {
    const result = await extractPdf(textPdf(), open, new AbortController().signal)
    expect(result.notice).toBeUndefined()
    expect(result.text).toBe([
      '--- page 1 ---',
      'Hello world',
      'Next',
      '--- page 2 ---',
      'Second page',
    ].join('\n'))
  })

  it('accepts a Buffer, which is what the child reads from stdin', async () => {
    const result = await extractPdf(Buffer.from(textPdf()), open, new AbortController().signal)
    expect(result.text).toContain('Hello world')
  })

  it('returns a notice when the PDF has no text layer', async () => {
    const result = await extractPdf(emptyTextPdf(), open, new AbortController().signal)
    expect(result).toEqual({ text: '', notice: 'This PDF has no text layer.' })
  })

  it('stops at the page cap and the character cap', async () => {
    const signal = new AbortController().signal
    const full = await extractPdf(textPdf(), open, signal)
    expect(full.capped).toBeUndefined()
    const firstPage = await extractPdf(textPdf(), { maxPages: 1, maxExtractedChars: open.maxExtractedChars }, signal)
    expect(firstPage.notice).toBeUndefined()
    expect(firstPage.text).toContain('--- page 1 ---')
    expect(firstPage.text).not.toContain('--- page 2 ---')
    expect(firstPage).toMatchObject({ capped: ['pages'], pageCount: 2 })
    const allPages = await extractPdf(textPdf(), { maxPages: 2, maxExtractedChars: open.maxExtractedChars }, signal)
    expect(allPages.capped).toBeUndefined()
    const splitAt = full.text.indexOf('\n--- page 2 ---')
    const exact = await extractPdf(textPdf(), { maxPages: open.maxPages, maxExtractedChars: splitAt }, signal)
    expect(exact).toEqual({ text: full.text.slice(0, splitAt), capped: ['chars'] })
    const whole = await extractPdf(textPdf(), { maxPages: open.maxPages, maxExtractedChars: full.text.length }, signal)
    expect(whole).toEqual({ text: full.text })
    const partial = await extractPdf(textPdf(), { maxPages: open.maxPages, maxExtractedChars: 8 }, signal)
    expect(partial).toEqual({ text: full.text.slice(0, 8), capped: ['chars'] })
    const both = await extractPdf(textPdf(), { maxPages: 1, maxExtractedChars: 8 }, signal)
    expect(both).toEqual({ text: full.text.slice(0, 8), capped: ['chars'] })
  })

  it('returns empty text when a cap is below one, and rejects corrupt bytes', async () => {
    const signal = new AbortController().signal
    await expect(extractPdf(textPdf(), { maxPages: 0, maxExtractedChars: 20 }, signal)).resolves.toEqual({ text: '' })
    await expect(extractPdf(textPdf(), { maxPages: 2, maxExtractedChars: 0 }, signal)).resolves.toEqual({ text: '' })
    await expect(extractPdf(new Uint8Array([1, 2, 3, 4]), open, signal)).rejects.toThrow()
  })

  it('rejects when the signal is already aborted or aborts during the read', async () => {
    const reason = new Error('stopped')
    await expect(extractPdf(textPdf(), open, AbortSignal.abort(reason))).rejects.toBe(reason)
    const controller = new AbortController()
    const pending = extractPdf(textPdf(), open, controller.signal)
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })
})
