/**
 * PDF text-layer extraction for `read_document`.
 * PDF.js runs in a Node worker thread and pages are read with `getTextContent`.
 * @module @deepseek-ai/dsh-tool-document/pdf
 */

import { readFile } from 'node:fs/promises'
import { Worker as Thread, type Transferable } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { getDocument, PDFWorker } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** Items from `getTextContent` without `includeMarkedContent`. */
type PdfTextItems = Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items']

/** Returned when the scanned pages contain no text items. */
const NO_TEXT_LAYER = 'This PDF has no text layer.'

/**
 * Browser-style port inside the PDF.js worker thread.
 * The first parent message is the worker's own ready signal.
 */
const WORKER_SOURCE = `
import { parentPort, workerData } from 'node:worker_threads'
if (parentPort === null) throw new Error('PDF.js text extraction requires a worker parent port')
const listeners = new Map()
const port = {
  postMessage(message, transfer) {
    parentPort.postMessage(message, transfer)
  },
  addEventListener(_type, listener) {
    const forward = (data) => { listener(new MessageEvent('message', { data })) }
    listeners.set(listener, forward)
    parentPort.on('message', forward)
  },
  removeEventListener(_type, listener) {
    const forward = listeners.get(listener)
    if (forward !== undefined) parentPort.off('message', forward)
    listeners.delete(listener)
  },
}
const { WorkerMessageHandler } = await import(workerData.workerUrl)
WorkerMessageHandler.initializeFromPort(port)
`

/** Caps for one PDF read. */
interface PdfExtractCaps {
  /** Maximum 1-based pages to read. */
  maxPages: number
  /** Maximum characters of returned text, including page markers. */
  maxExtractedChars: number
}

/**
 * Read the PDF text layer, grouping PDF.js text items into lines and prefixing each page that has text.
 * Scanned pages with no text items return an empty string and a notice. Corrupt bytes reject.
 * An aborted signal rejects with that signal's reason. The loading task is destroyed and the worker
 * thread is terminated before this function settles.
 * @param bytes - complete PDF bytes. PDF.js receives a copy.
 * @param caps - page and character limits. A limit below 1 returns empty text after a successful parse.
 * @param signal - cancels worker startup and page reads.
 * @returns extracted text, or `{ text: '', notice }` when the scanned pages have no text layer.
 */
export async function extractPdf(
  bytes: Uint8Array,
  caps: PdfExtractCaps,
  signal: AbortSignal,
): Promise<{ text: string; notice?: string }> {
  signal.throwIfAborted()
  const worker = startWorker()
  let bridge: PDFWorker | undefined
  let loading: ReturnType<typeof getDocument> | undefined
  try {
    await raceSignal(worker.ready, signal, worker.crashed)
    signal.throwIfAborted()
    bridge = PDFWorker.create({ port: workerPort(worker.thread) })
    loading = getDocument({
      data: bytes.slice(),
      worker: bridge,
      standardFontDataUrl: standardFontDataUrl(),
      BinaryDataFactory: PdfStandardFontData,
      stopAtErrors: true,
    })
    const pdf = await raceSignal(loading.promise, signal, worker.crashed)
    signal.throwIfAborted()
    if (caps.maxPages < 1 || caps.maxExtractedChars < 1) return { text: '' }
    return await collectPages(pdf, caps, signal, worker.crashed)
  } finally {
    await releasePdf(loading, bridge, worker.thread)
  }
}

/** Installed standard font directory. PDF.js requires the trailing slash. */
function standardFontDataUrl(): string {
  return new URL('../../standard_fonts/', import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
}

function startWorker(): { thread: Thread; ready: Promise<undefined>; crashed: Promise<never> } {
  const thread = new Thread(new URL(`data:text/javascript,${encodeURIComponent(WORKER_SOURCE)}`), {
    workerData: { workerUrl: import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs') },
  })
  const ready = Promise.withResolvers<undefined>()
  const failed = Promise.withResolvers<never>()
  thread.once('message', () => { ready.resolve(undefined) })
  /* v8 ignore next -- a worker crash rejects the in-flight read; successful reads do not emit error */
  thread.once('error', (error: Error) => { failed.reject(error) })
  return { thread, ready: ready.promise, crashed: failed.promise }
}

/**
 * Carry PDF.js messages across a Node worker thread.
 * PDF.js 6.3 drops its message listener through the `AbortSignal` passed to `addEventListener`.
 * @param thread - the thread running `pdf.worker.mjs`.
 * @returns the port passed to `PDFWorker.create`.
 */
function workerPort(thread: Thread): Worker {
  const port = {
    postMessage(message: unknown, transfer?: readonly Transferable[]): void {
      thread.postMessage(message, transfer)
    },
    addEventListener(_type: string, listener: (event: Event) => void, options: { signal: AbortSignal }): void {
      const forward = (data: unknown): void => { listener(new MessageEvent('message', { data })) }
      thread.on('message', forward)
      options.signal.addEventListener('abort', () => { thread.off('message', forward) }, { once: true })
    },
  }
  // PDF.js types this argument as Worker. The adapter implements the methods it calls.
  return port as Worker
}

async function raceSignal<T>(promise: Promise<T>, signal: AbortSignal, crashed: Promise<never>): Promise<T> {
  signal.throwIfAborted()
  const subscription = new AbortController()
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = (): void => { reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true, signal: subscription.signal })
  })
  try {
    return await Promise.race([promise, crashed, aborted])
  } finally {
    subscription.abort()
  }
}

async function collectPages(
  pdf: PDFDocumentProxy,
  caps: PdfExtractCaps,
  signal: AbortSignal,
  crashed: Promise<never>,
): Promise<{ text: string; notice?: string }> {
  let text = ''
  let sawText = false
  const pageLimit = Math.min(pdf.numPages, caps.maxPages)
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    signal.throwIfAborted()
    const body = await pageBody(pdf, pageNumber, signal, crashed)
    if (body.length === 0) continue
    sawText = true
    const separator = text.length === 0 ? '' : '\n'
    const appended = appendCapped(text, `${separator}--- page ${pageNumber} ---\n${body}`, caps.maxExtractedChars)
    text = appended.text
    if (appended.full) break
  }
  if (!sawText) return { text: '', notice: NO_TEXT_LAYER }
  return { text }
}

async function pageBody(pdf: PDFDocumentProxy, pageNumber: number, signal: AbortSignal, crashed: Promise<never>): Promise<string> {
  const page = await raceSignal(pdf.getPage(pageNumber), signal, crashed)
  try {
    signal.throwIfAborted()
    const content = await raceSignal(page.getTextContent(), signal, crashed)
    return linesFromItems(content.items)
  } finally {
    page.cleanup()
  }
}

/**
 * Join text items on one line. PDF.js inserts gap spaces and sets `hasEOL` at a line break.
 * @param items - one page's `getTextContent` items.
 * @returns the page body, without a trailing newline.
 */
function linesFromItems(items: PdfTextItems): string {
  const lines: string[] = []
  let line = ''
  for (const item of items) {
    /* v8 ignore next -- getTextContent is called without includeMarkedContent */
    if (!('str' in item)) continue
    line += item.str
    if (!item.hasEOL) continue
    lines.push(line)
    line = ''
  }
  lines.push(line)
  return lines.join('\n').replace(/\n$/, '')
}

function appendCapped(text: string, chunk: string, maxChars: number): { text: string; full: boolean } {
  const room = maxChars - text.length
  if (room <= 0) return { text, full: true }
  if (chunk.length <= room) return { text: `${text}${chunk}`, full: false }
  return { text: `${text}${chunk.slice(0, room)}`, full: true }
}

async function releasePdf(
  loading: ReturnType<typeof getDocument> | undefined,
  bridge: PDFWorker | undefined,
  thread: Thread,
): Promise<void> {
  try {
    await loading?.destroy()
  } finally {
    bridge?.destroy()
    await thread.terminate()
  }
}

/** Reads installed standard font files. PDF.js constructs this while loading a document. */
class PdfStandardFontData {
  readonly #root: string

  constructor(options: { standardFontDataUrl: string }) {
    this.#root = options.standardFontDataUrl
  }

  async fetch(request: { filename: string }): Promise<Uint8Array> {
    const path = fileURLToPath(new URL(request.filename, this.#root))
    return new Uint8Array(await readFile(path))
  }
}
