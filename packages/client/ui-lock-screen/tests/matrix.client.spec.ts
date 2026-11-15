/** Code rain simulation and painting against a recording 2D context. */
import { describe, expect, it } from 'vitest'
import { MatrixRain, rainPace } from '../src/client/matrix.ts'
import type { SceneView } from '../src/client/scene.ts'

interface Glyph { text: string; fill: string; alpha: number }

function recorder() {
  const glyphs: Glyph[] = []
  const target = {
    fillStyle: '',
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillRect() {},
    fillText(text: string) { glyphs.push({ text, fill: target.fillStyle, alpha: target.globalAlpha }) },
  }
  return { ctx: target as Partial<CanvasRenderingContext2D> as CanvasRenderingContext2D, glyphs }
}

function sequence(values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]!
}

const view = (overrides: Partial<SceneView> = {}): SceneView => ({ now: new Date(0), running: 1, waiting: 0, done: 0, ...overrides })

describe('rainPace', () => {
  it('slows idle rain and speeds up with running agents up to four', () => {
    expect(rainPace({ running: 0 })).toBe(0.6)
    expect(rainPace({ running: 2 })).toBe(1.5)
    expect(rainPace({ running: 9 })).toBe(2)
  })
})

describe('MatrixRain', () => {
  it('paints green trails under bright heads and tints new columns red while waiting', () => {
    const rain = new MatrixRain(sequence([0.05, 0.4, 0.8, 0.15, 0.6, 0.95, 0.3]), false)
    const paint = recorder()
    rain.tick(view())
    rain.render(paint.ctx, 200, 120, 10)
    expect(paint.glyphs.length).toBeGreaterThan(0)
    expect(paint.glyphs.some(glyph => glyph.fill === '#d8ffe4' && glyph.alpha === 1)).toBe(true)
    expect(paint.glyphs.some(glyph => glyph.fill === '#00ff66')).toBe(true)
    for (let step = 0; step < 1200; step++) rain.tick(view({ waiting: 1 }))
    paint.glyphs.length = 0
    rain.render(paint.ctx, 200, 120, 10)
    expect(paint.glyphs.some(glyph => glyph.fill === '#ff4a4a')).toBe(true)
    expect(paint.ctx.globalAlpha).toBe(1)
  })

  it('keeps the grid across same-size frames and refits on resize under reduced motion', () => {
    const rain = new MatrixRain(() => 0.5, true)
    const paint = recorder()
    rain.render(paint.ctx, 100, 100, 10)
    rain.tick(view({ running: 0 }))
    rain.render(paint.ctx, 100, 100, 10)
    paint.glyphs.length = 0
    rain.render(paint.ctx, 40, 40, 10)
    expect(paint.glyphs.length).toBeGreaterThan(0)
    expect(paint.ctx.font).toBe("9px ui-monospace, 'MS Gothic', 'Noto Sans Mono CJK JP', monospace")
  })
})
