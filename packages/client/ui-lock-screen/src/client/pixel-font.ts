/**
 * 3x5 bitmap font for the lock screen's canvas art. Each glyph is fifteen bits,
 * row by row; letters render as capitals and unknown characters as blanks.
 */

const GLYPHS: Readonly<Record<string, string>> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '(': '001010010010001', ')': '100010010010100', '{': '011010110010011', '}': '110010011010110',
  '[': '110100100100110', ']': '011001001001011', ';': '000010000010100', '.': '000000000000010', ',': '000000000010100',
  '=': '000111000111000', '"': '101101000000000', "'": '010010000000000', '<': '001010100010001', '>': '100010001010100',
  '@': '010101111100011', '+': '000010111010000', '-': '000000111000000', '/': '001001010100100', '*': '101010101000000',
  '!': '010010010000010', ':': '000010000010000', _: '000000000000111', '?': '110001010000010', $: '011110010011110',
  '#': '101111101111101',
}

/** Horizontal advance of one character at scale 1, in canvas pixels. */
export const GLYPH_ADVANCE = 4

/**
 * Draw text with the bitmap font.
 * @param ctx - target 2D context.
 * @param text - characters to draw.
 * @param x - left edge.
 * @param y - top edge.
 * @param color - fill color.
 * @param scale - pixel multiplier.
 */
export function drawPixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, scale = 1): void {
  ctx.fillStyle = color
  for (let index = 0; index < text.length; index++) {
    const glyph = GLYPHS[text.charAt(index).toUpperCase()]
    if (glyph === undefined) continue
    for (let bit = 0; bit < 15; bit++) {
      if (glyph.charCodeAt(bit) !== 49) continue
      const left = Math.floor(x + index * GLYPH_ADVANCE * scale + (bit % 3) * scale)
      ctx.fillRect(left, Math.floor(y + Math.floor(bit / 3) * scale), scale, scale)
    }
  }
}
