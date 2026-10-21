/**
 * XLSX text for `read_document`.
 * ExcelJS loads the workbook and skips drawings. Formula caches are taken from the file and are not recalculated.
 * @module @deepseek-ai/dsh-tool-document/xlsx
 */

import ExcelJS, { type Cell, type Row, type Worksheet } from 'exceljs'
import type { ChildOutput, ExtractionCap } from './extract.ts'

/** Caps for one workbook read. */
interface XlsxExtractCaps {
  /** Maximum worksheets to read, in workbook order. */
  maxSheets: number
  /** Maximum non-empty rows per worksheet, a header row included. */
  maxRowsPerSheet: number
  /** Maximum characters of returned text, including headings. */
  maxExtractedChars: number
}

/** How reading one worksheet ended. */
type SheetEnd = 'done' | 'rows' | 'chars'

/**
 * Read an XLSX workbook into plain text.
 * Each worksheet contributes one heading line, `#` and the sheet name, then at most `caps.maxRowsPerSheet`
 * tab-separated non-empty rows, a header row included.
 * A formula cell uses the cached result stored in the file, including `0` and `false`.
 * When the file stores no result, the cell contributes its formula string, or nothing when ExcelJS has none.
 * Cells covered by a merge, other than the origin cell, are blank. The result is at most `caps.maxExtractedChars` long.
 * Reading stops at the first cap that drops content. `capped` lists the caps that did, with `sheetCount`
 * for `sheets` and the first cut sheet's name for `rows`.
 * An aborted signal rejects with its abort reason. A workbook ExcelJS cannot read rejects with the load error.
 * @param bytes - Complete XLSX bytes. A view is copied from its own range.
 * @param caps - Sheet, data-row, and character caps.
 * @param signal - Checked before loading and before each sheet and row.
 * @returns Plain text and the caps that cut it.
 */
export async function extractXlsx(bytes: Uint8Array, caps: XlsxExtractCaps, signal: AbortSignal): Promise<ChildOutput> {
  signal.throwIfAborted()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(new Uint8Array(bytes).buffer, { ignoreNodes: ['drawing'] })
  signal.throwIfAborted()

  let text = ''
  let rowsSheet: string | undefined
  let charsCapped = false
  const sheets = workbook.worksheets
  for (const sheet of sheets.slice(0, caps.maxSheets)) {
    signal.throwIfAborted()
    const end = appendLine(heading(sheet.name)) ? appendRows(sheet) : 'chars'
    if (end === 'rows' && rowsSheet === undefined) rowsSheet = sheet.name
    if (end === 'chars') {
      charsCapped = true
      break
    }
  }
  const sheetsCapped = !charsCapped && sheets.length > caps.maxSheets
  const capped: ExtractionCap[] = [
    ...sheetsCapped ? ['sheets' as const] : [],
    ...rowsSheet === undefined ? [] : ['rows' as const],
    ...charsCapped ? ['chars' as const] : [],
  ]
  if (capped.length === 0) return { text }
  return {
    text,
    capped,
    ...sheetsCapped ? { sheetCount: sheets.length } : {},
    ...rowsSheet === undefined ? {} : { rowsSheet },
  }

  /** Append the sheet's non-empty rows. Iteration ends at the first dropped row. */
  function appendRows(sheet: Worksheet): SheetEnd {
    let rows = 0
    for (let number = 1; number <= sheet.rowCount; number += 1) {
      const row = sheet.findRow(number)
      if (row === undefined || !row.hasValues) continue
      signal.throwIfAborted()
      const line = rowText(row)
      if (line.length === 0) continue
      if (rows >= caps.maxRowsPerSheet) return 'rows'
      rows += 1
      if (!appendLine(line)) return 'chars'
    }
    return 'done'
  }

  /** Append one line up to the character cap. Returns false when part of it was dropped. */
  function appendLine(line: string): boolean {
    const room = caps.maxExtractedChars - text.length
    if (room <= 0) return false
    const chunk = text.length === 0 ? line : `\n${line}`
    if (chunk.length <= room) {
      text += chunk
      return true
    }
    text += chunk.slice(0, room)
    return false
  }
}

function heading(name: string): string {
  return `# ${singleLine(name)}`
}

function rowText(row: Row): string {
  const fields: string[] = []
  let column = 0
  row.eachCell((cell, col) => {
    while (column + 1 < col) {
      fields.push('')
      column += 1
    }
    fields.push(singleLine(cellText(cell)))
    column = col
  })
  let end = fields.length
  while (end > 0 && fields[end - 1] === '') end -= 1
  return fields.slice(0, end).join('\t')
}

function cellText(cell: Cell): string {
  if (cell.type === ExcelJS.ValueType.Merge) return ''
  if (cell.type === ExcelJS.ValueType.Formula) return formulaText(cell)
  if (cell.value instanceof Date) return cell.value.toISOString()
  return cell.text
}

function formulaText(cell: Cell): string {
  // ExcelJS omits falsy caches from cell.value. The model result keeps 0 and false.
  const cached: unknown = cell.model.result
  if (typeof cached === 'string' || typeof cached === 'number' || typeof cached === 'boolean') return String(cached)
  if (cached instanceof Object && 'error' in cached) return String(cached.error)
  if (cached instanceof Date) return cached.toISOString()
  // ExcelJS types formula as a string, but a shared-formula clone whose master is missing has none.
  const formula = cell.formula as string | undefined
  return formula ?? ''
}

function singleLine(text: string): string {
  return text.replace(/[\t\r\n]/g, ' ')
}
