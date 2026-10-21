/** XLSX extraction keeps stored formula results and stops at the sheet, row, and character caps. */
import ExcelJS from 'exceljs'
import { expect, it, vi } from 'vitest'
import { extractXlsx } from '../src/xlsx.ts'
import { xlsxWithSheetData } from './fixtures/xlsx.ts'

const caps = { maxSheets: 8, maxRowsPerSheet: 50, maxExtractedChars: 10_000 }

function signal(): AbortSignal {
  return new AbortController().signal
}

async function xlsx(fill: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  fill(workbook)
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

async function text(bytes: Uint8Array, limits: typeof caps): Promise<string> {
  return (await extractXlsx(bytes, limits, signal())).text
}

it('writes one heading per sheet and TSV rows from cached formula results', async () => {
  const bytes = await xlsx((workbook) => {
    const sheet = workbook.addWorksheet('Budget')
    sheet.getCell('A1').value = 'Name'
    sheet.getCell('C1').value = 'Gap'
    sheet.getCell('A2').value = { formula: '1-1', result: 0 }
    sheet.getCell('B2').value = { formula: '1=2', result: false }
    sheet.getCell('C2').value = { formula: '1+1', result: 2 }
    sheet.getCell('D2').value = { formula: 'SUM(1,2)' }
    sheet.getCell('A3').value = { formula: 'CONCAT("hi")', result: 'hello' }
    sheet.getCell('B3').value = { formula: 'DATE(2026,9,16)', result: new Date('2026-09-16T00:00:00Z') }
    sheet.getCell('B3').numFmt = 'yyyy-mm-dd'
    sheet.getCell('C3').value = { formula: '1/0', result: { error: '#DIV/0!' } }
    sheet.getCell('A4').value = { richText: [{ text: 'Rich' }, { text: ' text' }] }
    sheet.getCell('B4').value = { text: 'Link', hyperlink: 'https://example.com' }
    sheet.getCell('C4').value = { error: '#N/A' }
    sheet.getCell('D4').value = true
    sheet.getCell('A5').value = new Date('2026-01-02T00:00:00Z')
    sheet.getCell('A5').numFmt = 'yyyy-mm-dd'
    sheet.getCell('B5').value = 12
    sheet.getCell('A6').value = 'line\nand\ttab'
    sheet.mergeCells('A7:B8')
    sheet.getCell('A7').value = 'merged'
    const hidden = workbook.addWorksheet('Hidden', { state: 'hidden' })
    hidden.getCell('A1').value = 'secret'
    workbook.addWorksheet('Empty')
  })
  expect(await extractXlsx(bytes, caps, signal())).toEqual({
    text: [
      '# Budget',
      'Name\t\tGap',
      '0\tfalse\t2\tSUM(1,2)',
      'hello\t2026-09-16T00:00:00.000Z\t#DIV/0!',
      'Rich text\tLink\t#N/A\ttrue',
      '2026-01-02T00:00:00.000Z\t12',
      'line and tab',
      'merged',
      '# Hidden',
      'secret',
      '# Empty',
    ].join('\n'),
  })
})

it('uses a shared formula string when that cell stores no cached result', async () => {
  const bytes = await xlsx((workbook) => {
    const sheet = workbook.addWorksheet('Shared')
    sheet.getCell('A1').value = { formula: 'SUM(1,2)', result: 3 }
    sheet.getCell('A2').value = { sharedFormula: 'A1' }
  })
  expect(await text(bytes, caps)).toBe('# Shared\n3\nSUM(1,2)')
})

it('writes an empty cell for a shared-formula clone whose master is missing', async () => {
  const bytes = xlsxWithSheetData(
    '<row r="1"><c r="A1" t="str"><v>left</v></c><c r="B1"><f t="shared" si="7"/></c><c r="C1" t="str"><v>right</v></c></row>',
  )
  expect(await text(bytes, caps)).toBe('# Sheet\nleft\t\tright')
})

it('skips missing and value-less rows without counting them against the row cap', async () => {
  const bytes = await xlsx((workbook) => {
    const sheet = workbook.addWorksheet('Gaps')
    sheet.getCell('A1').value = 'one'
    sheet.getRow(2).height = 30
    sheet.getCell('A4').value = 'four'
  })
  expect(await extractXlsx(bytes, { ...caps, maxRowsPerSheet: 2 }, signal())).toEqual({ text: '# Gaps\none\nfour' })
})

it('stops at the sheet cap, the data-row cap, and the character cap and reports each', async () => {
  const bytes = await xlsx((workbook) => {
    const first = workbook.addWorksheet('One')
    first.getCell('A1').value = 'a'
    first.getCell('A2').value = 'bb'
    first.getCell('C2').value = 'c'
    workbook.addWorksheet('Two').getCell('A1').value = 'zzzz'
  })
  const full = '# One\na\nbb\t\tc\n# Two\nzzzz'
  expect(await extractXlsx(bytes, caps, signal())).toEqual({ text: full })
  expect(await extractXlsx(bytes, { ...caps, maxSheets: 0 }, signal())).toEqual({ text: '', capped: ['sheets'], sheetCount: 2 })
  expect(await extractXlsx(bytes, { ...caps, maxSheets: 1 }, signal()))
    .toEqual({ text: '# One\na\nbb\t\tc', capped: ['sheets'], sheetCount: 2 })
  expect(await extractXlsx(bytes, { ...caps, maxSheets: 2 }, signal())).toEqual({ text: full })
  expect(await extractXlsx(bytes, { ...caps, maxRowsPerSheet: 1 }, signal()))
    .toEqual({ text: '# One\na\n# Two\nzzzz', capped: ['rows'], rowsSheet: 'One' })
  const first = '# One\na\nbb\t\tc'
  expect(await extractXlsx(bytes, { ...caps, maxExtractedChars: first.length }, signal()))
    .toEqual({ text: first, capped: ['chars'] })
  expect(await extractXlsx(bytes, { ...caps, maxExtractedChars: full.length }, signal())).toEqual({ text: full })
  expect(await extractXlsx(bytes, { ...caps, maxExtractedChars: full.length - 1 }, signal()))
    .toEqual({ text: full.slice(0, -1), capped: ['chars'] })
  expect(await text(bytes, { ...caps, maxExtractedChars: 0 })).toBe('')
  expect(await text(bytes, { ...caps, maxExtractedChars: 1 })).toBe('#')
  expect(await extractXlsx(bytes, { ...caps, maxExtractedChars: 5 }, signal())).toEqual({ text: '# One', capped: ['chars'] })
  // A character stop leaves the remaining sheets unread without reporting the sheet cap.
  expect(await extractXlsx(bytes, { ...caps, maxSheets: 1, maxExtractedChars: 5 }, signal()))
    .toEqual({ text: '# One', capped: ['chars'] })
})

it('reports rows and chars together, naming the first sheet whose rows were cut', async () => {
  const bytes = await xlsx((workbook) => {
    const first = workbook.addWorksheet('First')
    first.getCell('A1').value = 'a'
    first.getCell('A2').value = 'b'
    const second = workbook.addWorksheet('Second')
    second.getCell('A1').value = 'c'
    second.getCell('A2').value = 'd'
    workbook.addWorksheet('Third').getCell('A1').value = 'long text'
  })
  expect(await extractXlsx(bytes, { ...caps, maxRowsPerSheet: 1 }, signal())).toEqual({
    text: '# First\na\n# Second\nc\n# Third\nlong text',
    capped: ['rows'],
    rowsSheet: 'First',
  })
  const prefix = '# First\na\n# Second\nc\n# Third\nlong'
  expect(await extractXlsx(bytes, { maxSheets: 2, maxRowsPerSheet: 1, maxExtractedChars: prefix.length }, signal())).toEqual({
    text: '# First\na\n# Second\nc',
    capped: ['sheets', 'rows'],
    sheetCount: 3,
    rowsSheet: 'First',
  })
  expect(await extractXlsx(bytes, { ...caps, maxRowsPerSheet: 1, maxExtractedChars: prefix.length }, signal())).toEqual({
    text: prefix,
    capped: ['rows', 'chars'],
    rowsSheet: 'First',
  })
})

it('stops iterating a sheet once the row cap drops a row', async () => {
  const bytes = await xlsx((workbook) => {
    const sheet = workbook.addWorksheet('Long')
    for (let row = 1; row <= 200; row += 1) sheet.getCell(`A${row}`).value = row
  })
  const prototype = Object.getPrototypeOf(new ExcelJS.Workbook().addWorksheet('probe')) as { findRow(row: number): unknown }
  const findRow = vi.spyOn(prototype, 'findRow')
  try {
    expect(await extractXlsx(bytes, { ...caps, maxRowsPerSheet: 2 }, signal()))
      .toEqual({ text: '# Long\n1\n2', capped: ['rows'], rowsSheet: 'Long' })
    expect(findRow).toHaveBeenCalledTimes(3)
  } finally {
    findRow.mockRestore()
  }
})

it('truncates one cell to the remaining characters and counts characters rather than UTF-8 bytes', async () => {
  const wide = await xlsx((workbook) => {
    workbook.addWorksheet('S').getCell('A1').value = 'abcdef'
  })
  expect(await text(wide, { ...caps, maxExtractedChars: 5 })).toBe('# S\na')

  const cjk = await xlsx((workbook) => {
    workbook.addWorksheet('字').getCell('A1').value = '字'
  })
  const result = await text(cjk, { ...caps, maxExtractedChars: 3 })
  expect(result).toBe('# 字')
  expect(result.length).toBe(3)
  expect(Buffer.byteLength(result)).toBeGreaterThan(result.length)
})

it('reads a byte view and ignores drawings', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const bytes = await xlsx((workbook) => {
    const sheet = workbook.addWorksheet('Pic')
    sheet.getCell('A1').value = 'caption'
    const image = workbook.addImage({ base64: png, extension: 'png' })
    sheet.addImage(image, { tl: { col: 1, row: 1 }, ext: { width: 8, height: 8 } })
  })
  const padded = new Uint8Array(bytes.length + 4)
  padded.set(bytes, 4)
  const view = padded.subarray(4)
  expect(view.byteOffset).not.toBe(0)
  const result = await text(view, caps)
  expect(result).toBe('# Pic\ncaption')
  expect(result).not.toContain('PNG')
})

it('rejects an aborted signal and bytes that are not a workbook', async () => {
  const controller = new AbortController()
  controller.abort()
  const bytes = await xlsx((workbook) => {
    workbook.addWorksheet('S').getCell('A1').value = 'a'
  })
  await expect(extractXlsx(bytes, caps, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  await expect(extractXlsx(new Uint8Array([1, 2, 3]), caps, signal())).rejects.toThrow()
})
