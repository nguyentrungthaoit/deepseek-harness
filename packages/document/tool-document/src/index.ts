/**
 * Model-facing `read_document` tool. The parent resolves the path, enforces the byte cap,
 * checks ZIP limits for docx and xlsx, and spawns one read-only child. Parsers do not run here.
 * Finished extractions are cached by `FsTarget.targetKey`, `FsInfo.version`, and size, so reading on with `offset`
 * does not spawn again.
 * @module @deepseek-ai/dsh-tool-document
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { ExtractionCache } from './cache.ts'
import type { ExtractionOutcome } from './cache.ts'
import { runChild } from './child.ts'
import type { ChildWatch } from './child.ts'
import type { ChildOutput, DocumentFormat, ExtractionCap } from './extract.ts'
import { ExtractionSlots } from './slots.ts'
import { assertZipLimits } from './zip-limit.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-document'

/** Services required to resolve a path, spawn a confined child, and add prompt guidance. */
export const inject = ['tools', 'fs', 'sandbox', 'subprocess', 'sandboxPolicy', 'systemPrompt']

/** Default maximum file bytes read before a child starts. */
const DEFAULT_MAX_INPUT_BYTES = 32 * 1024 * 1024

/** Default maximum ZIP central-directory entries for docx and xlsx. */
const DEFAULT_MAX_ARCHIVE_ENTRIES = 2000

/** Default maximum declared uncompressed ZIP size for docx and xlsx. */
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024

/** Default maximum PDF pages the child may read. */
const DEFAULT_MAX_PAGES = 50

/** Default maximum characters the child may return. */
const DEFAULT_MAX_EXTRACTED_CHARS = 1_000_000

/** Default child deadline, counted from spawn. */
const DEFAULT_TIMEOUT_MS = 30_000

/** Default and maximum lines returned by one call. */
const DEFAULT_LIMIT = 2000

/** Default maximum characters returned for one line. */
const DEFAULT_MAX_LINE_LENGTH = 2000

/** Default maximum bytes of selected lines. Matches the `read` tool so a normal result stays inline. */
const DEFAULT_MAX_BYTES = 50 * 1024

/** Default maximum Excel sheets. */
const DEFAULT_MAX_SHEETS = 32

/** Default maximum non-empty rows read from one sheet, a header row included. */
const DEFAULT_MAX_ROWS_PER_SHEET = 5_000

/** Default children running at once. */
const DEFAULT_MAX_CONCURRENT = 2

/** Default extractions waiting for a child slot. */
const DEFAULT_MAX_QUEUED = 8

/**
 * Default child V8 heap in MiB. ExcelJS needs roughly ten times the XML size, so a valid workbook near the
 * 32 MiB uncompressed cap can use 300-600 MB.
 */
const DEFAULT_MAX_HEAP_MB = 1024

/** Largest delay `setTimeout` accepts. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Finished extractions kept per plugin instance. */
const CACHE_MAX_ENTRIES = 4

/** Total UTF-16 bytes of kept extraction text. */
const CACHE_MAX_BYTES = 8 * 1024 * 1024

/** Plugin config. Every field is optional; {@link Config} supplies the defaults. */
export interface Config {
  /** Maximum file bytes. Larger files fail with `FS_TOO_LARGE` and are not truncated. */
  maxInputBytes?: number
  /** Maximum ZIP central-directory entries before the child starts. */
  maxArchiveEntries?: number
  /** Maximum declared uncompressed ZIP size before the child starts. */
  maxUncompressedBytes?: number
  /** Maximum PDF pages the child may read. */
  maxPages?: number
  /** Maximum characters the child may return. */
  maxExtractedChars?: number
  /** Child deadline in milliseconds, counted from spawn. Time spent waiting for a slot does not count. */
  timeoutMs?: number
  /** Default and maximum lines returned by one call. */
  limit?: number
  /** Maximum characters returned for one line. */
  maxLineLength?: number
  /** Maximum bytes of the selected lines. */
  maxBytes?: number
  /** Maximum Excel sheets the child may read. */
  maxSheets?: number
  /** Maximum non-empty rows the child may read from one sheet. A header row counts like any other row. */
  maxRowsPerSheet?: number
  /** Maximum children running at once. */
  maxConcurrent?: number
  /** Maximum extractions waiting for a child slot. A call beyond this fails at once as busy. */
  maxQueued?: number
  /** Child V8 old-space cap in MiB, passed as `--max-old-space-size`. */
  maxHeapMb?: number
}

/** Schemastery schema for {@link Config}. Defaults apply at load. */
export const Config: z<Config> = z.object({
  maxInputBytes: z.number().default(DEFAULT_MAX_INPUT_BYTES),
  maxArchiveEntries: z.number().default(DEFAULT_MAX_ARCHIVE_ENTRIES),
  maxUncompressedBytes: z.number().default(DEFAULT_MAX_UNCOMPRESSED_BYTES),
  maxPages: z.number().default(DEFAULT_MAX_PAGES),
  maxExtractedChars: z.number().default(DEFAULT_MAX_EXTRACTED_CHARS),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  limit: z.number().default(DEFAULT_LIMIT),
  maxLineLength: z.number().default(DEFAULT_MAX_LINE_LENGTH),
  maxBytes: z.number().default(DEFAULT_MAX_BYTES),
  maxSheets: z.number().default(DEFAULT_MAX_SHEETS),
  maxRowsPerSheet: z.number().default(DEFAULT_MAX_ROWS_PER_SHEET),
  maxConcurrent: z.number().default(DEFAULT_MAX_CONCURRENT),
  maxQueued: z.number().default(DEFAULT_MAX_QUEUED),
  maxHeapMb: z.number().default(DEFAULT_MAX_HEAP_MB),
})

/** Config after schemastery has filled every default. */
type ResolvedConfig = Required<Config>

/** One numbered line in the canonical result. */
interface DocumentLine {
  number: number
  text: string
}

/**
 * Canonical `read_document` value. `notice` is present for a PDF with no text layer and when a cap
 * stopped extraction; a cap also sets `truncated`.
 */
interface DocumentValue {
  path: string
  format: DocumentFormat
  offset: number
  lines: DocumentLine[]
  totalLines: number
  truncated: boolean
  notice?: string
}

interface WindowRequest {
  offset: number
  limit: number
  maxLineLength: number
  maxBytes: number
}

/**
 * Register `read_document` and its prompt guidance.
 * @param ctx - the plugin context. Registrations end when its fiber disposes.
 * @param config - deployment caps. Schemastery has already applied defaults.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxInputBytes', resolved.maxInputBytes)
  assertPositiveInteger('maxArchiveEntries', resolved.maxArchiveEntries)
  assertPositiveInteger('maxUncompressedBytes', resolved.maxUncompressedBytes)
  assertPositiveInteger('maxPages', resolved.maxPages)
  assertPositiveInteger('maxExtractedChars', resolved.maxExtractedChars)
  assertPositiveInteger('timeoutMs', resolved.timeoutMs, MAX_TIMER_DELAY_MS)
  assertPositiveInteger('limit', resolved.limit)
  assertPositiveInteger('maxLineLength', resolved.maxLineLength)
  assertPositiveInteger('maxBytes', resolved.maxBytes)
  assertPositiveInteger('maxSheets', resolved.maxSheets)
  assertPositiveInteger('maxRowsPerSheet', resolved.maxRowsPerSheet)
  assertPositiveInteger('maxConcurrent', resolved.maxConcurrent)
  assertPositiveInteger('maxQueued', resolved.maxQueued)
  assertPositiveInteger('maxHeapMb', resolved.maxHeapMb)

  const slots = new ExtractionSlots(resolved.maxConcurrent, resolved.maxQueued)
  const cache = new ExtractionCache({ maxEntries: CACHE_MAX_ENTRIES, maxBytes: CACHE_MAX_BYTES })
  const live = new Set<{ terminate(): void; done: Promise<undefined> }>()
  ctx.effect(() => async () => {
    slots.dispose()
    const settled = cache.dispose()
    const pending = [...live]
    for (const item of pending) item.terminate()
    await Promise.all(pending.map(item => item.done))
    await settled
  }, 'document extractor quiescence')
  const watch: ChildWatch = {
    watch(handle) {
      const exited = Promise.withResolvers<undefined>()
      const item = { terminate: () => { handle.terminate() }, done: exited.promise }
      live.add(item)
      return { release: () => { live.delete(item); exited.resolve(undefined) } }
    },
  }

  ctx.systemPrompt.section({
    name: 'tool:read_document',
    order: ctx.systemPrompt.getSectionOrder('TOOL_READ_DOCUMENT'),
    text: ({ scope }) => ctx.tools.get('read_document', scope) === undefined
      ? ''
      : 'Use read_document, not read, for .docx, .pdf, and .xlsx files. Use offset to continue reading a long document.',
  })

  /**
   * One extraction under the shared signal. The slot is held from before the read until the child exits.
   * The caller that starts it supplies the sandbox policy; the read-only child sees only the bytes on stdin.
   */
  async function extractFile(
    exec: ToolExecution,
    target: FsTarget,
    info: FsInfo,
    format: DocumentFormat,
    signal: AbortSignal,
  ): Promise<ExtractionOutcome> {
    const release = await slots.acquire(signal)
    let output: ChildOutput
    try {
      const bytes = await ctx.fs.readBytes(target, signal, resolved.maxInputBytes)
      switch (format) {
        case 'docx':
        case 'xlsx':
          assertZipLimits(bytes, {
            maxArchiveEntries: resolved.maxArchiveEntries,
            maxUncompressedBytes: resolved.maxUncompressedBytes,
          })
          break
        case 'pdf':
          break
        /* v8 ignore next 2 -- DocumentFormat is a closed union */
        default:
          return assertNever(format, 'read_document format')
      }
      const policy = exec.agent === undefined
        ? ctx.sandboxPolicy.resolve()
        : ctx.sandboxPolicy.resolve({ session: exec.agent.session })
      output = await runChild(ctx, {
        bytes,
        request: {
          format,
          maxPages: resolved.maxPages,
          maxExtractedChars: resolved.maxExtractedChars,
          maxSheets: resolved.maxSheets,
          maxRowsPerSheet: resolved.maxRowsPerSheet,
        },
        timeoutMs: resolved.timeoutMs,
        maxHeapMb: resolved.maxHeapMb,
        signal,
        workspaceRoot: policy.workspaceRoot,
        ...policy.sessionId === undefined ? {} : { sessionId: policy.sessionId },
        watch,
      })
    } finally {
      release()
    }
    // The bytes were read after the first stat. Keep the result only when the file still matches it.
    const after = await ctx.fs.stat(target, signal).catch(() => undefined)
    return { output, cacheable: after !== undefined && after.version === info.version && after.size === info.size }
  }

  ctx.tools.register(defineTool({
    name: 'read_document',
    description: 'Read text and tables from a .docx, .pdf, or .xlsx file. Use read_document for these extensions because read rejects binary files. Word paragraphs and tables become text lines, Excel sheets become tab-separated rows, and PDF text comes from the text layer with page markers.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to a .docx, .pdf, or .xlsx file, resolved by the filesystem backend.',
      },
      offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
      limit: { type: 'number', description: `Maximum number of lines to return. Defaults to ${resolved.limit}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          format: { type: 'string', enum: ['docx', 'pdf', 'xlsx'] as const, required: true },
          offset: { type: 'integer', required: true },
          lines: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'integer', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
          totalLines: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          notice: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderDocument(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseArgs(args, resolved.limit)
      // Every session resolves and stats with its own cwd and signal before the shared cache is consulted.
      const { target, info } = await resolveFile(ctx, exec, input.filePath)
      const format = formatOf(target.displayPath)
      // `targetKey` is the backend's stable identity; display paths can differ for one file and repeat across backends.
      const key = JSON.stringify([target.targetKey, info.version, info.size])
      const output = await cache.run(key, exec.signal, signal => extractFile(exec, target, info, format, signal))
      const window = windowLines(output.text, {
        offset: input.offset,
        limit: input.limit,
        maxLineLength: resolved.maxLineLength,
        maxBytes: resolved.maxBytes,
      }, target.displayPath)
      return documentValue(target.displayPath, format, input.offset, window, output, resolved)
    },
  }))
}

function assertPositiveInteger(field: string, value: number, max?: number): void {
  if (!Number.isInteger(value) || value < 1 || (max !== undefined && value > max)) {
    const limit = max === undefined ? '' : ` no greater than ${max}`
    throw new Error(`tool-document: ${field} must be a positive integer${limit}`)
  }
}

function parseArgs(
  args: { file_path: string; offset?: number; limit?: number },
  maxLimit: number,
): { filePath: string; offset: number; limit: number } {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  const offset = args.offset === undefined ? 1 : parsePositiveInteger(args.offset, 'offset')
  const limit = args.limit === undefined ? maxLimit : parsePositiveInteger(args.limit, 'limit')
  if (limit > maxLimit) throw new Error(`limit must be less than or equal to ${maxLimit}`)
  return { filePath: args.file_path, offset, limit }
}

function parsePositiveInteger(value: number, field: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`)
  }
  return value
}

async function resolveFile(ctx: Context, exec: ToolExecution, requestedPath: string): Promise<{ target: FsTarget; info: FsInfo }> {
  const cwd = exec.agent?.session.header.cwd
  const target = await ctx.fs.resolve(requestedPath, {
    ...cwd === undefined ? {} : { cwd },
    signal: exec.signal,
  })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  if (info.type !== 'file') throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  return { target, info }
}

function formatOf(path: string): DocumentFormat {
  const dot = path.lastIndexOf('.')
  const extension = dot === -1 ? '' : path.slice(dot).toLowerCase()
  switch (extension) {
    case '.docx': return 'docx'
    case '.pdf': return 'pdf'
    case '.xlsx': return 'xlsx'
    default: throw new Error('read_document accepts only .docx, .pdf, and .xlsx files')
  }
}

function splitLines(text: string): string[] {
  if (text.length === 0) return []
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  if (body.length === 0) return []
  return body.split('\n')
}

function fitLine(line: string, maxLineLength: number): string {
  if (line.length <= maxLineLength) return line
  return `${line.slice(0, maxLineLength)}... (line truncated to ${maxLineLength} chars)`
}

/**
 * Cut one line to at most `maxBytes` UTF-8 bytes on a character boundary, marker included.
 * When even the marker does not fit, the line is cut to `maxBytes` without it.
 */
function fitLineBytes(line: string, maxBytes: number): string {
  const marker = `... (line truncated to ${maxBytes} bytes)`
  const markerBytes = Buffer.byteLength(marker, 'utf8')
  if (markerBytes > maxBytes) return utf8Prefix(line, maxBytes)
  return `${utf8Prefix(line, maxBytes - markerBytes)}${marker}`
}

/** The longest prefix of `text` whose UTF-8 encoding fits in `maxBytes`, never splitting a character. */
function utf8Prefix(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8')
  let end = Math.min(maxBytes, bytes.length)
  // A continuation byte (10xxxxxx) at the cut means the cut falls inside a character.
  while (end > 0 && end < bytes.length && (bytes.readUInt8(end) & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString('utf8')
}

function windowLines(
  text: string,
  request: WindowRequest,
  displayPath: string,
): { lines: DocumentLine[]; totalLines: number; truncated: boolean } {
  const all = splitLines(text)
  const lines: DocumentLine[] = []
  let outputBytes = 0
  let truncatedByBytes = false
  for (const [index, raw] of all.entries()) {
    const number = index + 1
    if (truncatedByBytes || number < request.offset || lines.length >= request.limit) continue
    const textLine = fitLine(raw, request.maxLineLength)
    const bytes = Buffer.byteLength(textLine, 'utf8') + (lines.length > 0 ? 1 : 0)
    if (outputBytes + bytes > request.maxBytes) {
      truncatedByBytes = true
      // The first selected line is always returned, cut to the byte cap, so `offset` always moves forward.
      if (lines.length === 0) lines.push({ number, text: fitLineBytes(raw.slice(0, request.maxLineLength), request.maxBytes) })
      continue
    }
    outputBytes += bytes
    lines.push({ number, text: textLine })
  }
  if (request.offset > all.length && !(all.length === 0 && request.offset === 1)) {
    throw new Error(`offset ${request.offset} is out of range for "${displayPath}" (${all.length} lines)`)
  }
  // Lines before `offset` were asked to be skipped. A window is cut only when lines remain after it,
  // which also covers the byte cap: the first line that did not fit is one of them.
  const end = lines.at(-1)?.number ?? 0
  return { lines, totalLines: all.length, truncated: end < all.length }
}

function documentValue(
  path: string,
  format: DocumentFormat,
  offset: number,
  window: { lines: DocumentLine[]; totalLines: number; truncated: boolean },
  output: ChildOutput,
  caps: ResolvedConfig,
): DocumentValue {
  const notice = documentNotice(output, caps)
  return {
    path,
    format,
    offset,
    lines: window.lines,
    totalLines: window.totalLines,
    truncated: window.truncated || output.capped !== undefined,
    ...notice === undefined ? {} : { notice },
  }
}

/** The child's notice followed by one sentence per cap that stopped extraction. */
function documentNotice(output: ChildOutput, caps: ResolvedConfig): string | undefined {
  const parts = output.notice === undefined ? [] : [output.notice]
  for (const cap of output.capped ?? []) parts.push(capNotice(cap, output, caps))
  return parts.length === 0 ? undefined : parts.join(' ')
}

function capNotice(cap: ExtractionCap, output: ChildOutput, caps: ResolvedConfig): string {
  switch (cap) {
    case 'pages':
      return `Extraction stopped at maxPages (${ofTotal(caps.maxPages, output.pageCount, 'pages')}).`
    case 'sheets':
      return `Extraction stopped at maxSheets (${ofTotal(caps.maxSheets, output.sheetCount, 'sheets')}).`
    case 'rows': {
      const sheet = output.rowsSheet === undefined ? '' : `, first in sheet ${JSON.stringify(output.rowsSheet)}`
      return `Extraction stopped at maxRowsPerSheet (${caps.maxRowsPerSheet} rows per sheet${sheet}).`
    }
    case 'chars':
      return `Extraction stopped at maxExtractedChars (${caps.maxExtractedChars} characters).`
    /* v8 ignore next 2 -- parseChildOutput admits only the four caps */
    default:
      return assertNever(cap, 'read_document cap')
  }
}

function ofTotal(cap: number, total: number | undefined, unit: string): string {
  return total === undefined ? `${cap} ${unit}` : `${cap} of ${total} ${unit}`
}

function renderDocument(value: DocumentValue): string {
  const end = value.lines.at(-1)?.number ?? Math.max(0, value.offset - 1)
  let footer: string
  if (!value.truncated) footer = '(End of document)'
  else if (end < value.totalLines) {
    footer = `(Output capped. Showing lines ${value.offset}-${end} of ${value.totalLines}. Use offset=${end + 1} to continue.)`
  } else if (value.totalLines === 0) {
    footer = '(Extraction stopped early and returned no text. See the notice above.)'
  } else {
    footer = `(End of extracted text at line ${end}. Extraction stopped early, so the document continues past it. See the notice above.)`
  }
  const notice = value.notice === undefined ? '' : `${value.notice}\n`
  const body = value.lines.map(line => `${line.number}|${line.text}`).join('\n')
  const gap = body.length > 0 ? '\n' : ''
  return `<document path=${JSON.stringify(value.path)} format="${value.format}">\n${notice}${body}${gap}${footer}\n</document>`
}
