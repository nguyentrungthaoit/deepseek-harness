/** Child request parsing and format dispatch, called directly rather than through a subprocess. */
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { extract, readRequest } from '../src/extract.ts'
import type { ChildRequest } from '../src/extract.ts'
import { sampleDocx } from './fixtures/docx.ts'
import { textPdf } from './fixtures/pdf.ts'

const CAPS = { maxPages: 10, maxExtractedChars: 10_000, maxSheets: 4, maxRowsPerSheet: 10 }

function request(format: ChildRequest['format'], caps: Partial<typeof CAPS> = {}): ChildRequest {
  return { format, ...CAPS, ...caps }
}

describe('readRequest', () => {
  it('reads the format and every cap', () => {
    expect(readRequest(JSON.stringify(request('xlsx')))).toEqual(request('xlsx'))
  })

  it('rejects malformed JSON, a non-object, an unknown format, and a missing cap', () => {
    expect(() => readRequest('{')).toThrow(SyntaxError)
    expect(() => readRequest('null')).toThrow('request is not an object')
    expect(() => readRequest('3')).toThrow('request is not an object')
    expect(() => readRequest(JSON.stringify({ ...CAPS, format: 'pptx' }))).toThrow('request has no format')
    const { maxSheets: _omitted, ...rest } = request('pdf')
    expect(() => readRequest(JSON.stringify(rest))).toThrow('request is missing maxSheets')
    expect(() => readRequest(JSON.stringify({ ...request('pdf'), maxPages: '2' }))).toThrow('request is missing maxPages')
  })
})

describe('extract', () => {
  it('dispatches docx with the character cap', async () => {
    const signal = new AbortController().signal
    expect((await extract(request('docx'), sampleDocx(), signal)).text).toContain('Hello & world')
    expect(await extract(request('docx', { maxExtractedChars: 5 }), sampleDocx(), signal))
      .toEqual({ text: 'Hello', capped: ['chars'] })
  })

  it('dispatches pdf with the page cap', async () => {
    const result = await extract(request('pdf', { maxPages: 1 }), textPdf(), new AbortController().signal)
    expect(result).toMatchObject({ capped: ['pages'], pageCount: 2 })
    expect(result.text).toContain('--- page 1 ---')
  })

  it('dispatches xlsx with the sheet and row caps', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Data')
    sheet.getCell('A1').value = 'a'
    sheet.getCell('A2').value = 'b'
    workbook.addWorksheet('Other').getCell('A1').value = 'c'
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
    expect(await extract(request('xlsx', { maxSheets: 1, maxRowsPerSheet: 1 }), bytes, new AbortController().signal)).toEqual({
      text: '# Data\na',
      capped: ['sheets', 'rows'],
      sheetCount: 2,
      rowsSheet: 'Data',
    })
  })
})
