/**
 * The Matrix lock screen's code rain: columns of half-width katakana and
 * digits falling over black at full device resolution. The rain speeds up
 * while agents run, slows when all are idle, and tints some new columns red
 * while a Session waits for approval.
 *
 * `tick()` advances the simulation by one 60 Hz step and `render()` paints the
 * current state; the overlay drives both from requestAnimationFrame.
 */
import type { SceneView } from './scene.ts'

/** Glyph cell edge in CSS pixels. */
export const MATRIX_CELL = 18

// Every glyph is one UTF-16 unit, so `charAt` picks whole glyphs.
const GLYPHS = 'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ012345789Z:.=*+-<>¦'
const GREEN = '#00ff66'
const ALERT = '#ff4a4a'
const HEAD = '#d8ffe4'

interface Column {
  head: number
  speed: number
  length: number
  alert: boolean
}

/**
 * Rain speed multiplier for the current agent activity.
 * @param view - live agent counts.
 * @returns the multiplier; idle rain falls slower than busy rain.
 */
export function rainPace(view: Pick<SceneView, 'running'>): number {
  return view.running > 0 ? 1 + 0.25 * Math.min(view.running, 4) : 0.6
}

/** The code rain simulation and renderer. */
export class MatrixRain {
  private columns: Column[] = []
  private glyphs: string[] = []
  private cols = 0
  private rows = 0

  /**
   * @param random - uniform source in [0, 1).
   * @param reducedMotion - slower rain with fewer glyph changes.
   */
  constructor(private readonly random: () => number, private readonly reducedMotion: boolean) {}

  /**
   * Advance one 60 Hz step.
   * @param view - live agent counts.
   */
  tick(view: SceneView): void {
    const pace = rainPace(view) * (this.reducedMotion ? 0.35 : 1)
    for (const column of this.columns) {
      column.head += column.speed * pace
      if (column.head - column.length > this.rows) this.spawn(column, view.waiting > 0, false)
    }
    const changes = this.reducedMotion ? 1 : Math.ceil(this.glyphs.length / 400)
    for (let index = 0; index < changes && this.glyphs.length > 0; index++) {
      this.glyphs[Math.floor(this.random() * this.glyphs.length)] = this.glyph()
    }
  }

  /**
   * Paint the rain, refitting the grid to the canvas first.
   * @param ctx - target context.
   * @param width - canvas width in device pixels.
   * @param height - canvas height in device pixels.
   * @param cell - glyph cell edge in device pixels.
   */
  render(ctx: CanvasRenderingContext2D, width: number, height: number, cell: number): void {
    this.fit(Math.ceil(width / cell), Math.ceil(height / cell))
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000400'
    ctx.fillRect(0, 0, width, height)
    ctx.font = `${String(Math.round(cell * 0.9))}px ui-monospace, 'MS Gothic', 'Noto Sans Mono CJK JP', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    this.columns.forEach((column, x) => {
      const top = Math.floor(column.head)
      for (let depth = 0; depth < column.length; depth++) {
        const y = top - depth
        if (y < 0 || y >= this.rows) continue
        const fade = 1 - depth / column.length
        ctx.globalAlpha = depth === 0 ? 1 : fade * fade * 0.9
        ctx.fillStyle = depth === 0 ? HEAD : column.alert ? ALERT : GREEN
        /* v8 ignore next -- fit() sizes the grid to cols * rows, so every in-bounds cell holds a glyph. */
        ctx.fillText(this.glyphs[y * this.cols + x] ?? '', x * cell + cell / 2, y * cell)
      }
    })
    ctx.globalAlpha = 1
  }

  private fit(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    this.glyphs = Array.from({ length: cols * rows }, () => this.glyph())
    this.columns = Array.from({ length: cols }, () => {
      const column: Column = { head: 0, speed: 0, length: 0, alert: false }
      this.spawn(column, false, true)
      return column
    })
  }

  private spawn(column: Column, waiting: boolean, initial: boolean): void {
    column.head = initial ? this.random() * this.rows * 1.5 - this.rows * 0.5 : -this.random() * this.rows * 0.6
    column.speed = 0.12 + this.random() * 0.33
    column.length = 8 + Math.floor(this.random() * 22)
    column.alert = waiting && this.random() < 0.25
  }

  private glyph(): string {
    return GLYPHS.charAt(Math.floor(this.random() * GLYPHS.length))
  }
}
