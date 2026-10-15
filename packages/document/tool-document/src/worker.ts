/**
 * Child entry for `read_document`.
 * Reads file bytes from stdin, dispatches by format, and writes JSON text to stdout.
 * The user path is not in argv. Parsers live in the sibling modules this file imports.
 * @module @deepseek-ai/dsh-tool-document/worker
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import { extractDocx } from './docx.ts'
import { extractPdf } from './pdf.ts'
import { extractXlsx } from './xlsx.ts'

/** Formats this child can dispatch. */
type DocumentFormat = 'docx' | 'pdf' | 'xlsx'

/** JSON argv written by the parent. */
interface ChildRequest {
  format: DocumentFormat
  maxPages: number
  maxExtractedChars: number
  maxSheets: number
  maxRowsPerSheet: number
}

const SENSITIVE_ENV = /KEY|SECRET|TOKEN|PASSWORD/i

function assertCleanEnvironment(): void {
  const names = Object.keys(process.env).filter(name => SENSITIVE_ENV.test(name)).sort()
  if (names.length === 0) return
  process.stderr.write(`refusing credential-shaped environment: ${names.join(', ')}\n`)
  process.exit(1)
}

function childSignal(): AbortSignal {
  const controller = new AbortController()
  const abort = (): void => { controller.abort() }
  process.once('SIGTERM', abort)
  process.once('SIGINT', abort)
  return controller.signal
}

function readRequest(raw: string): ChildRequest {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null) throw new Error('read_document child request is not an object')
  const record: Record<string, unknown> = { ...value }
  if (record.format !== 'docx' && record.format !== 'pdf' && record.format !== 'xlsx') {
    throw new Error('read_document child request has no format')
  }
  return {
    format: record.format,
    maxPages: requiredNumber(record, 'maxPages'),
    maxExtractedChars: requiredNumber(record, 'maxExtractedChars'),
    maxSheets: requiredNumber(record, 'maxSheets'),
    maxRowsPerSheet: requiredNumber(record, 'maxRowsPerSheet'),
  }
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const field = record[key]
  if (typeof field !== 'number') throw new Error(`read_document child request is missing ${key}`)
  return field
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const chunk of process.stdin) {
    if (typeof chunk === 'string') chunks.push(Buffer.from(chunk))
    else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
    else throw new Error('read_document child stdin chunk was not bytes')
  }
  return Buffer.concat(chunks)
}

async function extract(request: ChildRequest, bytes: Uint8Array, signal: AbortSignal): Promise<{ text: string; notice?: string }> {
  switch (request.format) {
    case 'docx':
      return { text: await extractDocx(bytes, signal) }
    case 'xlsx':
      return {
        text: await extractXlsx(bytes, {
          maxSheets: request.maxSheets,
          maxRowsPerSheet: request.maxRowsPerSheet,
          maxExtractedChars: request.maxExtractedChars,
        }, signal),
      }
    case 'pdf': {
      const extracted = await extractPdf(bytes, {
        maxPages: request.maxPages,
        maxExtractedChars: request.maxExtractedChars,
      }, signal)
      return extracted.notice === undefined ? { text: extracted.text } : { text: extracted.text, notice: extracted.notice }
    }
    default:
      return assertNever(request.format, 'read_document format')
  }
}

async function main(): Promise<void> {
  assertCleanEnvironment()
  const raw = process.argv.at(-1)
  if (raw === undefined) throw new Error('read_document child is missing its request')
  const request = readRequest(raw)
  const bytes = await readStdin()
  const result = await extract(request, bytes, childSignal())
  process.stdout.write(JSON.stringify(result))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
