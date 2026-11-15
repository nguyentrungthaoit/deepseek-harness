/** Scene simulation and painting against a recording 2D context. */
import { describe, expect, it } from 'vitest'
import { drawPixelText } from '../src/client/pixel-font.ts'
import { highlightJava, mavenRun, PixelScene, type SceneView } from '../src/client/scene.ts'

interface Recorder {
  ctx: CanvasRenderingContext2D
  rects: { fill: string; x: number; y: number; w: number; h: number }[]
  images: number
}

function recorder(): Recorder {
  const record: Recorder = { ctx: undefined as never, rects: [], images: 0 }
  const target = {
    fillStyle: '',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    fillRect(x: number, y: number, w: number, h: number) { record.rects.push({ fill: target.fillStyle, x, y, w, h }) },
    drawImage() { record.images++ },
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
  }
  record.ctx = target as Partial<CanvasRenderingContext2D> as CanvasRenderingContext2D
  return record
}

function canvasFactory(withContext: boolean): () => HTMLCanvasElement {
  return () => ({
    width: 0,
    height: 0,
    getContext: () => (withContext ? recorder().ctx : null),
  }) as Partial<HTMLCanvasElement> as HTMLCanvasElement
}

function sequence(values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]!
}

const view = (overrides: Partial<SceneView> = {}): SceneView => ({
  now: new Date(2026, 9, 29, 21, 47, 5), running: 1, waiting: 1, done: 2, ...overrides,
})

describe('PixelScene', () => {
  it('runs every animation cycle and paints each frame', () => {
    const scene = new PixelScene(sequence([0.001, 0.2, 0.5, 0.9, 0.3, 0.7]), false, canvasFactory(true))
    const paint = recorder()
    for (let step = 0; step < 2400; step++) {
      scene.tick(view({ running: step < 1200 ? 1 : 0, waiting: step % 2 }))
      if (step % 7 === 0) scene.render(paint.ctx, view({ waiting: step % 2 }))
    }
    expect(paint.rects.length).toBeGreaterThan(1000)
    expect(paint.images).toBeGreaterThan(0)
    expect(paint.ctx.globalAlpha).toBe(1)
  })

  it('keeps reduced motion free of lightning and tolerates missing offscreen contexts', () => {
    const scene = new PixelScene(() => 0, true, canvasFactory(false))
    const paint = recorder()
    // A random source of 0 fails every Maven run; Duke is still sad 300 steps in.
    for (let step = 0; step < 300; step++) scene.tick(view({ running: 0, waiting: 0 }))
    scene.render(paint.ctx, view({ running: 0, waiting: 0 }))
    expect(paint.rects.some(rect => rect.fill === '#e8e8ff')).toBe(false)
  })
})

describe('highlightJava', () => {
  it('colors comments, strings, annotations, numbers, keywords, types, calls, and punctuation', () => {
    const colors = Object.fromEntries(highlightJava('@Service public Lock run(1, "x"); // done').map(([token, color]) => [token, color]))
    expect(colors).toMatchObject({
      '@Service': '#7ee0a0', public: '#ff6ac1', Lock: '#58c8f8', run: '#c8a8f8', 1: '#f8a060',
      '"x"': '#f8d860', ';': '#9a98c8', '// done': '#6a6a90', ',': '#c8c8e8',
    })
  })
})

describe('mavenRun', () => {
  it('ends a passing run in BUILD SUCCESS and a failing one in BUILD FAILURE', () => {
    expect(mavenRun(false)[5]![0]![0]).toBe('BUILD SUCCESS')
    expect(mavenRun(true)[5]![0]![0]).toBe('BUILD FAILURE')
    expect(mavenRun(true)[4]![0]![0]).toBe('[ERROR] ')
  })
})

describe('drawPixelText', () => {
  it('draws lit bits at the given scale and skips unknown characters', () => {
    const paint = recorder()
    drawPixelText(paint.ctx, 'i~', 10, 20, '#fff', 2)
    expect(paint.rects).toHaveLength(9)
    expect(paint.rects[0]).toEqual({ fill: '#fff', x: 10, y: 20, w: 2, h: 2 })
  })
})
