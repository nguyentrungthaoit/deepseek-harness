/** XLSX extraction keeps stored formula results and stops at the sheet, row, and character caps. */
import ExcelJS from 'exceljs'
import { expect, it } from 'vitest'
import { extractXlsx } from '../src/xlsx.ts'

const caps = { maxSheets: 8, maxRowsPerSheet: 50, maxExtractedChars: 10_000 }

function signal(): AbortSignal {
  return new AbortController().signal
}

async function xlsx(fill: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  fill(workbook)
  return new Uint8Array(await workbook.xlsx.writeBuffer())
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
  const text = await extractXlsx(bytes, caps, signal())
  expect(text).toBe([
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
  ].join('\n'))
})

it('uses a shared formula string when that cell stores no cached result', async () => {
  const bytes = await xlsx((workbook) => {
    const sheet = workbook.addWorksheet('Shared')
    sheet.getCell('A1').value = { formula: 'SUM(1,2)', result: 3 }
    sheet.getCell('A2').value = { sharedFormula: 'A1' }
  })
  expect(await extractXlsx(bytes, caps, signal())).toBe('# Shared\n3\nSUM(1,2)')
})

it('stops at the sheet cap, the data-row cap, and the character cap', async () => {
  const bytes = await xlsx((workbook) => {
    const first = workbook.addWorksheet('One')
    first.getCell('A1').value = 'a'
    first.getCell('A2').value = 'bb'
    first.getCell('C2').value = 'c'
    workbook.addWorksheet('Two').getCell('A1').value = 'zzzz'
  })
  const full = '# One\na\nbb\t\tc\n# Two\nzzzz'
  expect(await extractXlsx(bytes, caps, signal())).toBe(full)
  expect(await extractXlsx(bytes, { ...caps, maxSheets: 0 }, signal())).toBe('')
  expect(await extractXlsx(bytes, { ...caps, maxSheets: 1 }, signal())).toBe('# One\na\nbb\t\tc')
  expect(await extractXlsx(bytes, { ...caps, maxRowsPerSheet: 1 }, signal())).toBe('# One\na\n# Two\nzzzz')
  const first = '# One\na\nbb\t\tc'
  expect(await extractXlsx(bytes, { ...caps, maxExtractedChars: first.length }, signal())).toBe(first)
  expect(await extractXlsx(bytes, { ...caps, maxExtractedChars: full.length - 1 }, signal())).toBe(full.slice(0, -1))
  expect(await extractXlsx(bytes, { ...caps, maxExtractedChars: 0 }, signal())).toBe('')
  expect(await extractXlsx(bytes, { ...caps, maxExtractedChars: 1 }, signal())).toBe('#')
  expect(await extractXlsx(bytes, { ...caps, maxExtractedChars: 5 }, signal())).toBe('# One')
})

it('truncates one cell to the remaining characters and counts characters rather than UTF-8 bytes', async () => {
  const wide = await xlsx((workbook) => {
    workbook.addWorksheet('S').getCell('A1').value = 'abcdef'
  })
  expect(await extractXlsx(wide, { ...caps, maxExtractedChars: 5 }, signal())).toBe('# S\na')

  const cjk = await xlsx((workbook) => {
    workbook.addWorksheet('字').getCell('A1').value = '字'
  })
  const text = await extractXlsx(cjk, { ...caps, maxExtractedChars: 3 }, signal())
  expect(text).toBe('# 字')
  expect(text.length).toBe(3)
  expect(Buffer.byteLength(text)).toBeGreaterThan(text.length)
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
  const text = await extractXlsx(view, caps, signal())
  expect(text).toBe('# Pic\ncaption')
  expect(text).not.toContain('PNG')
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
