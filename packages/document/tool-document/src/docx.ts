/**
 * DOCX text for `read_document`.
 * Mammoth converts the package to HTML. Paragraph and table text is kept; images contribute nothing.
 * @module @deepseek-ai/dsh-tool-document/docx
 */

import mammoth from 'mammoth'
import type { ChildOutput } from './extract.ts'
import { htmlText } from './html-text.ts'

/**
 * Read a DOCX package into plain text.
 * Paragraphs, headings, and list items become lines. Table cells in a row are joined with tabs, and rows with newlines.
 * Images, including their alternative text, contribute no text. The result contains no HTML tags.
 * Text longer than `caps.maxExtractedChars` is cut to that length and reported as `capped: ['chars']`.
 * An aborted signal rejects with that signal's reason. Conversion starts only when the signal is still active.
 * @param bytes - complete DOCX bytes. Mammoth receives a copy.
 * @param caps - the character cap applied to the converted text. A cap of 0 returns empty text.
 * @param signal - cancels before conversion and while Mammoth is reading the package.
 * @returns plain text and the cap that cut it. Rejects when Mammoth cannot read `bytes` as a DOCX package.
 */
export async function extractDocx(
  bytes: Uint8Array,
  caps: { maxExtractedChars: number },
  signal: AbortSignal,
): Promise<ChildOutput> {
  signal.throwIfAborted()
  const converted = mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, {
    convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
  })
  const result = await raceSignal(converted, signal)
  signal.throwIfAborted()
  const text = htmlText(result.value)
  if (text.length <= caps.maxExtractedChars) return { text }
  return { text: text.slice(0, caps.maxExtractedChars), capped: ['chars'] }
}

function raceSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = (): void => { reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then((value) => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) reject(abortError(signal))
      else resolve(value)
    }, (error: unknown) => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) {
        reject(abortError(signal))
        return
      }
      /* v8 ignore next -- Mammoth rejects with Error objects; the fallback keeps the rejection an Error */
      reject(error instanceof Error ? error : new Error('DOCX conversion failed.'))
    })
  })
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError')
}
