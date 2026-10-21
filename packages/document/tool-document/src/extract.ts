/**
 * Request parsing and format dispatch for the `read_document` child.
 * `worker.ts` wires process argv, stdin, and stdout to these functions. The parent imports only the types.
 * @module @deepseek-ai/dsh-tool-document/extract
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import { extractDocx } from './docx.ts'
import { extractPdf } from './pdf.ts'
import { extractXlsx } from './xlsx.ts'

/** Document kinds the child knows how to dispatch. */
export type DocumentFormat = 'docx' | 'pdf' | 'xlsx'

/**
 * A cap that dropped part of the document. Child output lists caps in the order
 * `pages`, `sheets`, `rows`, `chars`, without duplicates.
 */
export type ExtractionCap = 'pages' | 'sheets' | 'rows' | 'chars'

/** Caps and format passed to the child as one JSON argv element. */
export interface ChildRequest {
  /** Which parser the child should run. */
  format: DocumentFormat
  /** Maximum PDF pages the child may read. */
  maxPages: number
  /** Maximum characters the child may return. */
  maxExtractedChars: number
  /** Maximum Excel sheets the child may read. */
  maxSheets: number
  /** Maximum non-empty rows the child may read from one sheet. A header row counts like any other row. */
  maxRowsPerSheet: number
}

/** Text the child wrote, the PDF notice, and the caps that cut the text. */
export interface ChildOutput {
  /** Extracted document text. */
  text: string
  /** Set only when a PDF has no text layer. */
  notice?: string
  /** Caps that dropped content. Absent when the whole document was read. */
  capped?: ExtractionCap[]
  /** Total PDF pages. Set when `capped` contains `pages`. */
  pageCount?: number
  /** Total workbook sheets. Set when `capped` contains `sheets`. */
  sheetCount?: number
  /** Name of the first sheet whose rows were cut. Set when `capped` contains `rows`. */
  rowsSheet?: string
}

/**
 * Parse the JSON request the parent placed in argv.
 * @param raw - the final argv element.
 * @returns the validated request. Rejects malformed JSON, an unknown format, and a missing or non-numeric cap.
 */
export function readRequest(raw: string): ChildRequest {
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

/**
 * Run the parser for `request.format` under the request's caps.
 * @param request - format and caps from {@link readRequest}.
 * @param bytes - complete file bytes read from stdin.
 * @param signal - cancels the parser. An aborted signal rejects with its reason.
 * @returns the text, the optional PDF notice, and the caps that cut the text.
 */
export async function extract(request: ChildRequest, bytes: Uint8Array, signal: AbortSignal): Promise<ChildOutput> {
  switch (request.format) {
    case 'docx':
      return extractDocx(bytes, { maxExtractedChars: request.maxExtractedChars }, signal)
    case 'xlsx':
      return extractXlsx(bytes, {
        maxSheets: request.maxSheets,
        maxRowsPerSheet: request.maxRowsPerSheet,
        maxExtractedChars: request.maxExtractedChars,
      }, signal)
    case 'pdf':
      return extractPdf(bytes, {
        maxPages: request.maxPages,
        maxExtractedChars: request.maxExtractedChars,
      }, signal)
    /* v8 ignore next 2 -- readRequest admits only the three formats */
    default:
      return assertNever(request.format, 'read_document format')
  }
}
