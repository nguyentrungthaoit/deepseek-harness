/** Falling-glyph field drawn from the streaming reasoning text while the model thinks. */
import type { PartialAssistant } from '../contract/snapshot.ts'

/** Reasoning characters kept as the glyph source; older text no longer reaches the band. */
const SOURCE_LENGTH = 96
/** Horizontal spacing of glyph columns, in CSS pixels. */
const COLUMN_WIDTH = 11
/** Vertical spacing of glyphs in one trail, in CSS pixels. */
const ROW_HEIGHT = 11
/** Glyphs per trail, the newest drawn brightest. */
const TRAIL = 3
/** Fall speed range, in CSS pixels per millisecond. */
const MIN_SPEED = 0.012
const SPEED_RANGE = 0.018

/**
 * Take the glyph source from the latest reasoning block while it streams.
 * @param partial - in-progress Assistant output, or null between model requests.
 * @returns the latest reasoning characters without whitespace, or an empty string when the model is not thinking.
 */
export function rainGlyphs(partial: PartialAssistant | null): string {
  const last = partial?.blocks.at(-1)
  if (last?.kind !== 'reasoning') return ''
  return last.text.slice(-SOURCE_LENGTH * 2).replace(/\s+/g, '').slice(-SOURCE_LENGTH)
}

/** The drawing calls the field uses, satisfied by `CanvasRenderingContext2D`. */
export interface RainPainter {
  globalAlpha: number
  clearRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
}

interface Column {
  /** Baseline of the newest glyph, in CSS pixels; negative while above the band. */
  y: number
  speed: number
  /** Row the newest glyph was taken at. */
  row: number
  readonly trail: string[]
}

/** Column positions and trails of one band; advanced by elapsed time, drawn on demand. */
export class RainField {
  private readonly columns: Column[] = []
  private cursor = 0

  /**
   * @param width - band width in CSS pixels.
   * @param height - band height in CSS pixels.
   * @param random - uniform source in [0, 1).
   */
  constructor(private readonly width: number, private readonly height: number, private readonly random: () => number) {
    const count = Math.max(1, Math.floor(width / COLUMN_WIDTH))
    for (let index = 0; index < count; index++) {
      const y = -random() * height
      this.columns.push({ y, speed: MIN_SPEED + random() * SPEED_RANGE, row: Math.floor(y / ROW_HEIGHT), trail: [] })
    }
  }

  /**
   * Move every column down; a column takes the next source glyph each time it enters a new row
   * and restarts above the band once its whole trail has left.
   * @param ms - elapsed time since the previous step.
   * @param glyphs - current glyph source; an empty source adds no glyphs.
   */
  advance(ms: number, glyphs: string): void {
    for (const column of this.columns) {
      column.y += column.speed * ms
      const row = Math.floor(column.y / ROW_HEIGHT)
      if (row !== column.row && glyphs !== '') {
        column.trail.push(glyphs[this.cursor % glyphs.length] as string)
        this.cursor++
        if (column.trail.length > TRAIL) column.trail.shift()
      }
      column.row = row
      if (column.y - TRAIL * ROW_HEIGHT > this.height) {
        column.y = -this.random() * this.height
        column.row = Math.floor(column.y / ROW_HEIGHT)
        column.speed = MIN_SPEED + this.random() * SPEED_RANGE
        column.trail.length = 0
      }
    }
  }

  /**
   * Clear the band and draw each column's trail, older glyphs fainter and higher.
   * @param painter - target drawing context with fill style and font already set.
   */
  draw(painter: RainPainter): void {
    painter.globalAlpha = 1
    painter.clearRect(0, 0, this.width, this.height)
    this.columns.forEach((column, index) => {
      const x = index * COLUMN_WIDTH
      column.trail.forEach((glyph, age) => {
        const rank = column.trail.length - age
        painter.globalAlpha = 1 / rank
        painter.fillText(glyph, x, column.row * ROW_HEIGHT - (rank - 1) * ROW_HEIGHT)
      })
    })
  }
}
