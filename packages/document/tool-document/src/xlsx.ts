/**
 * XLSX text for `read_document`.
 * ExcelJS loads the workbook and skips drawings. Formula caches are taken from the file and are not recalculated.
 * @module @deepseek-ai/dsh-tool-document/xlsx
 */

import ExcelJS, { type Cell, type Row } from 'exceljs'

/**
 * Read an XLSX workbook into plain text.
 * Each worksheet contributes one heading line, `#` and the sheet name, then at most `caps.maxRowsPerSheet` tab-separated data rows.
 * A formula cell uses the cached result stored in the file, including `0` and `false`.
 * When the file stores no result, the cell contributes its formula string.
 * Cells covered by a merge, other than the origin cell, are blank. The result is at most `caps.maxExtractedChars` long.
 * An aborted signal rejects with its abort reason. A workbook ExcelJS cannot read rejects with the load error.
 * @param bytes - Complete XLSX bytes. A view is copied from its own range.
 * @param caps - Sheet, data-row, and character caps. Extraction stops when a cap is reached.
 * @param signal - Checked before loading and before each sheet and row.
 * @returns Plain text.
 */
export async function extractXlsx(
  bytes: Uint8Array,
  caps: { maxSheets: number; maxRowsPerSheet: number; maxExtractedChars: number },
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(new Uint8Array(bytes).buffer, { ignoreNodes: ['drawing'] })
  signal.throwIfAborted()

  let text = ''
  for (const sheet of workbook.worksheets.slice(0, caps.maxSheets)) {
    signal.throwIfAborted()
    if (!appendLine(heading(sheet.name))) break
    let rows = 0
    let stop = false
    sheet.eachRow((row) => {
      if (stop || rows >= caps.maxRowsPerSheet) {
        stop = true
        return
      }
      signal.throwIfAborted()
      const line = rowText(row)
      if (line.length === 0) return
      rows += 1
      if (!appendLine(line)) stop = true
    })
  }
  return text

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
  const cached = cell.model.result
  if (typeof cached === 'string' || typeof cached === 'number' || typeof cached === 'boolean') return String(cached)
  if (cached instanceof Object && 'error' in cached) return String(cached.error)
  if (cached instanceof Date) return cached.toISOString()
  return cell.formula
}

function singleLine(text: string): string {
  return text.replace(/[\t\r\n]/g, ' ')
}
