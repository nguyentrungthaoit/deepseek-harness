/** PDF byte generators for text-layer extraction tests. */

/**
 * Build a one-revision PDF from indirect objects numbered in array order.
 * @param objects - object bodies, without `obj` or `endobj` wrappers.
 * @returns encoded PDF bytes.
 */
function pdfBytes(objects: readonly string[]): Uint8Array {
  let text = '%PDF-1.7\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(text.length)
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = text.length
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) text += `${String(offset).padStart(10, '0')} 00000 n \n`
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(text)
}

function streamObject(stream: string): string {
  return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
}

/**
 * Two-page Helvetica PDF. Page 1 has two text lines; page 2 has one.
 * @returns PDF bytes that contain a text layer.
 */
export function textPdf(): Uint8Array {
  const first = [
    'BT /F1 10 Tf 40 100 Td (Hello) Tj ET',
    'BT /F1 10 Tf 90 100 Td (world) Tj ET',
    'BT /F1 10 Tf 40 70 Td (Next) Tj ET',
  ].join('\n')
  const second = 'BT /F1 10 Tf 40 100 Td (Second page) Tj ET'
  return pdfBytes([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 140] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    streamObject(first),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 140] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    streamObject(second),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ])
}

/**
 * One page painted with a rectangle and no text operators.
 * @returns PDF bytes that have no text layer.
 */
export function emptyTextPdf(): Uint8Array {
  const stream = '0.2 0.2 0.2 rg 10 10 40 40 re f'
  return pdfBytes([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 100] /Contents 4 0 R >>',
    streamObject(stream),
  ])
}
