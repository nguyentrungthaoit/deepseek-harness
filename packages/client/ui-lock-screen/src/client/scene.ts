/**
 * The lock screen's animated pixel scene, drawn on a 640x360 canvas: a
 * late-night developer room with a rainy window, a neon sign, three monitors
 * (Java source, a JVM heap graph, a Maven build log), a server rack with Duke,
 * a cat that catches NullPointerException bugs, and a HUD. The bottom band
 * (y 292-360) is floor only; the overlay draws its dialog there in the DOM.
 *
 * `tick()` advances the simulation by one 60 Hz step and `render()` paints the
 * current state; the overlay drives both from requestAnimationFrame.
 */
import { drawPixelText, GLYPH_ADVANCE } from './pixel-font.ts'

/** Canvas width in scene pixels. */
export const SCENE_WIDTH = 640
/** Canvas height in scene pixels. */
export const SCENE_HEIGHT = 360

/** Live facts the scene reflects. */
export interface SceneView {
  /** Wall-clock time for the HUD clock and the wall clock. */
  readonly now: Date
  /** Sessions running, including those waiting for approval. */
  readonly running: number
  /** Sessions waiting for user interaction. */
  readonly waiting: number
  /** Sessions finished but not yet viewed. */
  readonly done: number
}

type Segment = readonly [text: string, color: string]
type LogLine = readonly Segment[]

const KEYWORDS = new Set('package import public private protected static final void class new return if while for try catch int boolean var this null true false throws extends'.split(' '))
/** Heap chart samples kept on screen. */
const HEAP_SAMPLES = 34

/** Leaf offsets of the desk plant from its pot, in scene px. */
const LEAVES: readonly (readonly [number, number])[] = [[-6, -14], [-1, -20], [5, -16], [9, -10], [-9, -8]]

function heapStart(index: number): number {
  return 30 + index * 1.6
}

/**
 * Pick the item at a fraction of a non-empty list.
 * @param items - a list with at least one item.
 * @param fraction - position in [0, 1).
 * @returns the item at `floor(fraction * length)`.
 */
function choose<T>(items: readonly T[], fraction: number): T {
  return items[Math.floor(fraction * items.length)] as T
}

/**
 * Read an index known to be in range.
 * @param items - the list.
 * @param index - a valid index into `items`.
 * @returns the item.
 */
function itemAt<T>(items: readonly T[], index: number): T {
  return items[index] as T
}

const SOURCE: readonly (readonly [number, string])[] = [
  [0, 'package dev.devz;'], [0, ''], [0, 'import java.util.*;'], [0, ''], [0, '@Service'], [0, 'public class Lock {'],
  [1, 'private final Agent ai;'], [1, 'private int fixes = 12;'], [0, ''], [1, '@Override'], [1, 'public void run() {'],
  [2, 'while (ai.busy()) {'], [3, 'Task t = ai.next();'], [3, 'try {'], [4, 't.execute();'], [4, 'fixes++;'],
  [3, '} catch (Exception e) {'], [4, 'log.warn("NPE", e);'], [3, '}'], [2, '}'], [1, '}'], [0, ''],
  [1, '// TODO: sleep more'], [1, 'public static void main('], [3, 'String[] args) {'], [2, 'new Lock().run();'],
  [1, '}'], [0, '}'], [0, ''], [0, ''],
]
const WX = 32
const WY = 48
const WW = 164
const WH = 142

/**
 * Split one Java source line into colored tokens.
 * @param line - source text.
 * @returns tokens with their syntax colors.
 */
export function highlightJava(line: string): Segment[] {
  const out: Segment[] = []
  const pattern = /(\/\/.*$)|("[^"]*")|(@\w+)|(\b\d+\b)|(\b[A-Za-z_]\w*\b)|(\s+)|(.)/gu
  for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
    const token = match[0]
    let color = '#c8c8e8'
    if (match[1] !== undefined) color = '#6a6a90'
    else if (match[2] !== undefined) color = '#f8d860'
    else if (match[3] !== undefined) color = '#7ee0a0'
    else if (match[4] !== undefined) color = '#f8a060'
    else if (match[5] !== undefined) {
      if (KEYWORDS.has(token)) color = '#ff6ac1'
      else if (/^[A-Z]/u.test(token)) color = '#58c8f8'
      else if (line[pattern.lastIndex] === '(') color = '#c8a8f8'
    } else if (match[7] !== undefined && '{}()[];'.includes(token)) color = '#9a98c8'
    out.push([token, color])
  }
  return out
}

/**
 * One Maven run as terminal lines; a failing run ends in BUILD FAILURE.
 * @param fail - whether the run fails.
 * @returns the lines in print order.
 */
export function mavenRun(fail: boolean): LogLine[] {
  const info = (text: string): LogLine => [['[INFO] ', '#58a8f8'], [text, '#a8a8c8']]
  return [
    [['$ ', '#7ee0a0'], ['mvn install', '#f0eeff']],
    info('Scanning'),
    info('compile'),
    info('Tests 128'),
    fail ? [['[ERROR] ', '#f86858'], ['1 FAIL', '#f8a0a0']] : info('-------'),
    fail ? [['BUILD FAILURE', '#f86858']] : [['BUILD SUCCESS', '#58f878']],
    info(fail ? '8.9s' : '8.2s'),
  ]
}

interface Particle { x: number; y: number; life: number; phase: number }

/** The scene simulation and renderer. */
export class PixelScene {
  private t = 0
  private flash = 0
  private codeScroll = 0
  private heap: [number, boolean][]
  private heapValue: number
  private gcCount = 12
  private mvn: LogLine[] = mavenRun(false).slice(1)
  private mvnQueue: LogLine[] = []
  private mvnWait = 90
  private dukeJoy = 0
  private dukeSad = 0
  private steam: (Particle & { bean: boolean })[] = []
  private notes: (Particle & { color: string })[] = []
  private zs: Particle[] = []
  private pops: Particle[] = []
  private bug: { x: number } | undefined
  private catAwake = 0
  private pounce = 0
  private fixes = 12
  private readonly stars: [number, number, number][]
  private readonly buildings: { x: number; w: number; h: number; color: string; windows: [number, number, boolean, boolean][] }[] = []
  private readonly drops: { x: number; y: number; speed: number }[]
  private readonly code: HTMLCanvasElement[]
  private ctx!: CanvasRenderingContext2D

  /**
   * @param random - uniform source in [0, 1).
   * @param reducedMotion - fewer raindrops and no lightning.
   * @param createCanvas - offscreen canvas factory for the cached code lines.
   */
  constructor(
    private readonly random: () => number,
    private readonly reducedMotion: boolean,
    createCanvas: () => HTMLCanvasElement,
  ) {
    const between = (a: number, b: number): number => a + this.random() * (b - a)
    const int = (a: number, b: number): number => Math.floor(between(a, b + 1))
    this.stars = Array.from({ length: 22 }, () => [int(WX, WX + WW), int(WY, WY + 60), int(0, 90)])
    for (let x = WX - 4; x < WX + WW;) {
      const w = int(16, 30)
      const h = int(36, 96)
      const windows: [number, number, boolean, boolean][] = []
      for (let y = WY + WH - h + 6; y < WY + WH - 6; y += 8) {
        for (let wx = x + 3; wx < x + w - 4; wx += 6) windows.push([wx, y, this.random() < 0.45, this.random() < 0.2])
      }
      this.buildings.push({ x, w, h, windows, color: this.buildings.length % 2 === 0 ? '#100d24' : '#161230' })
      x += w + int(0, 3)
    }
    this.drops = Array.from({ length: reducedMotion ? 18 : 60 }, () => ({
      x: between(WX, WX + WW + 40), y: between(WY, WY + WH), speed: between(2, 3.4),
    }))
    this.heap = Array.from({ length: HEAP_SAMPLES }, (_, index) => [heapStart(index), false])
    this.heapValue = heapStart(HEAP_SAMPLES - 1)
    this.code = SOURCE.map(([level, text]) => {
      const canvas = createCanvas()
      canvas.width = 120
      canvas.height = 5
      const lineCtx = canvas.getContext('2d')
      if (lineCtx !== null) {
        let x = level * 6
        for (const [token, color] of highlightJava(text)) {
          drawPixelText(lineCtx, token, x, 0, color)
          x += token.length * GLYPH_ADVANCE
        }
      }
      return canvas
    })
  }

  /**
   * Advance the simulation by one 60 Hz step.
   * @param view - live facts; agents typing and notes follow `running`.
   */
  tick(view: SceneView): void {
    const between = (a: number, b: number): number => a + this.random() * (b - a)
    this.t++
    const t = this.t
    for (const drop of this.drops) {
      drop.y += drop.speed
      drop.x -= drop.speed * 0.3
      if (drop.y > WY + WH) { drop.y = WY - 6; drop.x = between(WX, WX + WW + 40) }
    }
    if (t % 20 === 0) {
      // Every building is at least 36x16, so each holds lit-window slots.
      const building = choose(this.buildings, this.random())
      const window = choose(building.windows, this.random())
      window[2] = !window[2]
    }
    if (!this.reducedMotion && this.flash === 0 && this.random() < 0.0015) this.flash = 14
    if (this.flash > 0) this.flash--
    this.codeScroll += view.running > 0 ? 0.02 : 0.004
    if (t % 6 === 0) {
      this.heapValue += between(1.2, 3.4)
      let gc = false
      if (this.heapValue > 88) { this.heapValue = between(22, 32); this.gcCount++; gc = true }
      this.heap.shift()
      this.heap.push([this.heapValue, gc])
    }
    if (this.mvnQueue.length > 0) {
      if (t % 26 === 0) {
        const line = this.mvnQueue.shift() as LogLine
        this.mvn.push(line)
        if (this.mvn.length > 7) this.mvn.shift()
        const head = line[0]?.[0]
        if (head === 'BUILD SUCCESS') this.dukeJoy = 150
        if (head === 'BUILD FAILURE') this.dukeSad = 150
      }
    } else if (--this.mvnWait <= 0) {
      this.mvnQueue = mavenRun(this.random() < 0.25)
      this.mvnWait = 260
    }
    if (this.dukeJoy > 0) this.dukeJoy--
    if (this.dukeSad > 0) this.dukeSad--
    if (t % 10 === 0) this.steam.push({ x: between(226, 234), y: 210, life: 70, phase: between(0, 6), bean: t % 60 === 0 })
    this.steam = this.steam.filter((item) => { item.y -= 0.25; return --item.life > 0 })
    if (view.running > 0 && t % 55 === 0) {
      this.notes.push({ x: between(376, 384), y: 192, life: 90, phase: between(0, 6), color: this.random() < 0.5 ? '#ff4fa8' : '#4ff0ff' })
    }
    this.notes = this.notes.filter((item) => { item.y -= 0.3; return --item.life > 0 })
    if (this.bug === undefined && t % 900 === 300) this.bug = { x: 192 }
    if (this.bug !== undefined) {
      this.bug.x += 0.22
      if (this.bug.x > 452) this.catAwake = 40
      if (this.bug.x >= 478) {
        this.fixes++
        this.pops.push({ x: 466, y: 208, life: 80, phase: 0 })
        this.pounce = 24
        this.bug = undefined
      }
    }
    if (this.catAwake > 0) this.catAwake--
    if (this.pounce > 0) this.pounce--
    this.pops = this.pops.filter((item) => { item.y -= 0.25; return --item.life > 0 })
    if (t % 100 === 0 && this.catAwake === 0 && this.pounce === 0) this.zs.push({ x: 492, y: 208, life: 110, phase: 0 })
    this.zs = this.zs.filter((item) => { item.y -= 0.18; item.x -= 0.08; return --item.life > 0 })
  }

  /**
   * Paint the current state.
   * @param ctx - 640x360 canvas context.
   * @param view - live facts for the HUD and the developer.
   */
  render(ctx: CanvasRenderingContext2D, view: SceneView): void {
    this.ctx = ctx
    ctx.imageSmoothingEnabled = false
    this.wall()
    this.window()
    this.neon()
    this.clock(view.now)
    this.wallBits()
    this.floor()
    this.rack()
    this.desk()
    this.developer(view)
    this.hud(view)
  }

  private px(color: string, x: number, y: number, w: number, h: number): void {
    this.ctx.fillStyle = color
    this.ctx.fillRect(Math.floor(x), Math.floor(y), w, h)
  }

  private text(text: string, x: number, y: number, color: string, scale = 1): void {
    drawPixelText(this.ctx, text, x, y, color, scale)
  }

  private glow(text: string, x: number, y: number, color: string, halo: string, scale: number): void {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]] as const) {
      this.text(text, x + dx, y + dy, halo, scale)
    }
    this.text(text, x, y, color, scale)
  }

  private disc(cx: number, cy: number, r: number, color: string): void {
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy))
      this.px(color, cx - w, cy + dy, w * 2 + 1, 1)
    }
  }

  private ellipse(cx: number, cy: number, rx: number, ry: number, color: string): void {
    for (let dy = -ry; dy <= ry; dy++) {
      const w = Math.floor(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)))
      this.px(color, cx - w, cy + dy, w * 2 + 1, 1)
    }
  }

  private line(x0: number, y0: number, x1: number, y1: number, color: string): void {
    const steps = Math.max(1, Math.floor(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
    for (let i = 0; i <= steps; i++) this.px(color, x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, 1, 1)
  }

  private clip(x: number, y: number, w: number, h: number, draw: () => void): void {
    this.ctx.save()
    this.ctx.beginPath()
    this.ctx.rect(x, y, w, h)
    this.ctx.clip()
    draw()
    this.ctx.restore()
  }

  private alpha(value: number, draw: () => void): void {
    this.ctx.globalAlpha = value
    draw()
    this.ctx.globalAlpha = 1
  }

  private wall(): void {
    this.px('#1e1a3a', 0, 16, 640, 276)
    for (let x = 0; x < 640; x += 40) this.px('#1a1634', x, 16, 1, 276)
    this.px('#17142e', 0, 16, 640, 4)
    this.px('#141026', 0, 286, 640, 6)
    this.px('#2a2448', 0, 286, 640, 1)
  }

  private window(): void {
    const t = this.t
    this.px('#3a3060', WX - 6, WY - 6, WW + 12, WH + 12)
    this.clip(WX, WY, WW, WH, () => {
      ;['#0c0a24', '#100c2c', '#141038', '#1a1444', '#221a52'].forEach((color, i) => { this.px(color, WX, WY + i * 28, WW, 28) })
      for (const [x, y, phase] of this.stars) if ((t + phase) % 120 < 96) this.px('#e8e0ff', x, y, 1, 1)
      this.disc(WX + 40, WY + 26, 10, '#f0e8c8')
      this.px('#d8ccb0', WX + 36, WY + 22, 3, 3)
      this.px('#d8ccb0', WX + 43, WY + 29, 2, 2)
      for (const building of this.buildings) {
        this.px(building.color, building.x, WY + WH - building.h, building.w, building.h)
        this.px('#221c44', building.x, WY + WH - building.h, building.w, 1)
        for (const [x, y, lit, blue] of building.windows) if (lit) this.px(blue ? '#58c8f8' : '#f8d860', x, y, 2, 3)
      }
      this.px('#ff4fa8', WX + 118, WY + WH - 70, 1, 4)
      if (t % 40 < 20) this.px('#ff4fa8', WX + 117, WY + WH - 72, 3, 2)
      for (const drop of this.drops) {
        this.px('#5a68a8', drop.x, drop.y, 1, 3)
        this.px('#3a4680', drop.x + 1, drop.y - 2, 1, 2)
      }
      if (this.flash > 0 && this.flash % 4 < 2) this.alpha(0.35, () => { this.px('#e8e8ff', WX, WY, WW, WH) })
    })
    this.px('#3a3060', WX + WW / 2 - 2, WY, 4, WH)
    this.px('#3a3060', WX, WY + WH / 2 - 2, WW, 4)
    this.px('#4a3c70', WX - 10, WY + WH + 6, WW + 20, 6)
    this.px('#5a4c84', WX - 10, WY + WH + 6, WW + 20, 1)
    const sway = Math.round(Math.sin(t / 40))
    this.px('#a05a3a', WX + WW - 24, WY + WH - 6, 14, 12)
    this.px('#c0704a', WX + WW - 24, WY + WH - 6, 14, 2)
    LEAVES.forEach(([dx, dy], i) => {
      const x0 = WX + WW - 17
      const y0 = WY + WH - 6
      const tip = dx + (i % 2 === 1 ? sway : -sway)
      this.line(x0, y0, x0 + tip, y0 + dy, '#3a8a48')
      this.px('#58b860', x0 + tip - 1, y0 + dy - 1, 3, 2)
    })
  }

  private neon(): void {
    const t = this.t
    this.px('#3a3060', 262, 16, 1, 10)
    this.px('#3a3060', 430, 16, 1, 10)
    this.px('#120e24', 240, 26, 212, 62)
    this.px('#2a2448', 240, 26, 212, 1)
    this.px('#2a2448', 240, 87, 212, 1)
    this.px('#2a2448', 240, 26, 1, 62)
    this.px('#2a2448', 451, 26, 1, 62)
    const off = t % 360 < 5 || (t % 360 > 12 && t % 360 < 15)
    if (off) this.text('[AI] DEVZ TEAM', 264, 37, '#4a1038', 3)
    else this.glow('[AI] DEVZ TEAM', 264, 37, '#ff6ac1', '#6a1450', 3)
    if (t % 500 < 3) this.text('AWAY FROM KEYBOARD', 274, 66, '#0e3a44', 2)
    else this.glow('AWAY FROM KEYBOARD', 274, 66, '#7ff6ff', '#0e4a58', 2)
  }

  private clock(now: Date): void {
    const cx = 500
    const cy = 54
    this.disc(cx, cy, 17, '#4a3c70')
    this.disc(cx, cy, 15, '#e8e0d0')
    for (const [dx, dy] of [[0, -13], [13, 0], [0, 13], [-13, 0]] as const) this.px('#2a2440', cx + dx - 1, cy + dy - 1, 2, 2)
    const hour = now.getHours() % 12 + now.getMinutes() / 60
    const minute = now.getMinutes() + now.getSeconds() / 60
    const hand = (angle: number, length: number, color: string): void => {
      this.line(cx, cy, Math.round(cx + Math.sin(angle) * length), Math.round(cy - Math.cos(angle) * length), color)
    }
    hand(hour / 12 * Math.PI * 2, 7, '#2a2440')
    hand(minute / 60 * Math.PI * 2, 11, '#2a2440')
    hand(now.getSeconds() / 60 * Math.PI * 2, 12, '#e04858')
  }

  private wallBits(): void {
    const notes = [
      [208, 94, '#f8d860', '#c8a838', 'TODO', 'SLEEP'],
      [212, 118, '#ff8ac8', '#c85898', '@OVER', 'RIDE'],
      [436, 126, '#7ee0a0', '#48a868', 'NO', 'NULL'],
    ] as const
    for (const [x, y, fill, shade, first, second] of notes) {
      this.px(shade, x + 1, y + 1, 24, 17)
      this.px(fill, x, y, 24, 17)
      this.px('#e04858', x + 11, y + 1, 2, 2)
      this.text(first, x + 2, y + 4, '#3a2a20')
      this.text(second, x + 2, y + 11, '#3a2a20')
    }
    this.px('#3a3060', 556, 28, 60, 44)
    this.px('#4ff0ff', 560, 32, 52, 36)
    this.px('#2ab8d0', 560, 66, 52, 2)
    this.text('FATBOY', 563, 42, '#1e1a3a', 2)
    this.px('#1e1a3a', 562, 54, 48, 1)
    this.px('#6a4630', 462, 124, 78, 3)
    this.px('#3a2620', 468, 127, 2, 5)
    this.px('#3a2620', 532, 127, 2, 5)
    const books = [['EJ3', '#c84838', 22], ['CC', '#3a78c8', 18], ['SPR', '#58a848', 21], ['JCP', '#d8a838', 20], ['DDD', '#8858c8', 22], ['GOF', '#c8c8d8', 19]] as const
    books.forEach(([title, color, h], i) => {
      const x = 466 + i * 8
      this.px(color, x, 124 - h, 7, h)
      this.px('#ffffff55', x, 125 - h, 7, 1)
      Array.from(title).forEach((char, k) => { this.text(char, x + 2, 127 - h + k * 6, i === 5 ? '#3a3858' : '#f8f0e0') })
    })
    for (let k = 0; k < 16; k++) this.px(k < 2 || k > 13 ? '#7a3a58' : '#a84870', 516 + k * 0.6, 108 + k, 8, 1)
    this.px('#4a4470', 530, 112, 6, 12)
  }

  private monitor(x: number, y: number, w: number, h: number, draw: (x: number, y: number, w: number, h: number) => void): void {
    this.px('#2a2840', x + w / 2 - 3, y + h, 6, 226 - (y + h) - 2)
    this.px('#2a2840', x + w / 2 - 12, 224, 24, 2)
    this.px('#1a1828', x, y, w, h)
    this.px('#2c2a40', x, y, w, 1)
    this.px('#2c2a40', x, y, 1, h)
    this.clip(x + 3, y + 3, w - 6, h - 6, () => { draw(x + 3, y + 3, w - 6, h - 6) })
    this.px(this.t % 240 < 120 ? '#58f878' : '#3a8a48', x + w - 6, y + h - 2, 2, 1)
  }

  private codeScreen(x: number, y: number, w: number, h: number): void {
    this.px('#14121f', x, y, w, h)
    this.px('#1e1c2e', x, y, w, 8)
    this.px('#2a2840', x + 1, y + 1, 42, 7)
    this.text('LOCK.JAVA', x + 4, y + 2, '#f0eeff')
    this.text('POM.XML', x + 48, y + 2, '#6a6890')
    this.clip(x, y + 9, w, h - 9, () => {
      const active = 5
      const base = Math.floor(this.codeScroll)
      const offset = Math.round((this.codeScroll - base) * 7)
      this.px('#22203a', x, y + 9 + active * 7, w, 7)
      for (let row = -1; row < 11; row++) {
        const index = ((base + row) % SOURCE.length + SOURCE.length) % SOURCE.length
        const top = y + 10 + row * 7 - offset
        this.text(String(index + 1).padStart(2, ' '), x + 1, top, '#4a4870')
        this.ctx.drawImage(itemAt(this.code, index), x + 11, top)
        if (row === active + (offset > 3 ? 1 : 0) && this.t % 40 < 22) {
          const [level, source] = itemAt(SOURCE, index)
          this.px('#f8f8f8', x + 11 + level * 6 + source.length * GLYPH_ADVANCE, top - 1, 1, 7)
        }
      }
    })
  }

  private heapScreen(x: number, y: number, w: number, h: number): void {
    this.px('#0c1418', x, y, w, h)
    this.text('HEAP', x + 2, y + 2, '#58f8a8')
    this.text(`GC${this.gcCount}`, x + 24, y + 2, '#f8d860')
    this.text('512M', x + w - 17, y + 2, '#4a7a6a')
    const gy = y + 9
    const gh = h - 11
    for (let line = gy + gh - 10; line > gy; line -= 10) this.px('#10262a', x, line, w, 1)
    const limit = gy + gh - Math.round(0.9 * gh)
    for (let dash = x; dash < x + w; dash += 3) this.px('#6a2828', dash, limit, 2, 1)
    this.heap.forEach(([value, gc], i) => {
      const bar = Math.round(value / 100 * gh)
      const bx = x + 2 + i * 2
      this.px(value > 80 ? '#5a2a28' : '#1e5a48', bx, gy + gh - bar, 2, bar)
      this.px(value > 80 ? '#f86858' : '#58f8a8', bx, gy + gh - bar, 2, 1)
      if (gc) {
        this.px('#6a5a20', bx, gy, 1, gh - bar)
        this.px('#f8d860', bx, gy + gh - bar - 3, 1, 3)
      }
    })
  }

  private terminalScreen(x: number, y: number, w: number, h: number): void {
    this.px('#0a0a12', x, y, w, h)
    this.mvn.forEach((line, i) => {
      let left = x + 2
      for (const [text, color] of line) {
        this.text(text, left, y + 2 + i * 7, color)
        left += text.length * GLYPH_ADVANCE
      }
    })
    if (this.mvnQueue.length === 0) {
      const top = y + 2 + this.mvn.length * 7
      this.text('$', x + 2, top, '#7ee0a0')
      if (this.t % 40 < 22) this.px('#58f878', x + 8, top, 3, 5)
    }
  }

  private desk(): void {
    const t = this.t
    this.px('#4a3022', 204, 234, 8, 54)
    this.px('#4a3022', 516, 234, 8, 54)
    this.px('#3a2620', 212, 234, 56, 52)
    this.px('#4a3022', 214, 236, 52, 22)
    this.px('#4a3022', 214, 260, 52, 24)
    this.px('#a07850', 236, 246, 8, 2)
    this.px('#a07850', 236, 271, 8, 2)
    this.px('#6a4630', 196, 226, 332, 8)
    this.px('#8a5e40', 196, 226, 332, 1)
    this.alpha(0.1, () => { this.px('#7ab8ff', 214, 216, 300, 10) })
    this.monitor(210, 150, 82, 62, (x, y, w, h) => { this.heapScreen(x, y, w, h) })
    this.monitor(300, 132, 128, 82, (x, y, w, h) => { this.codeScreen(x, y, w, h) })
    this.monitor(436, 150, 80, 62, (x, y, w, h) => { this.terminalScreen(x, y, w, h) })
    this.px('#2a2840', 334, 221, 66, 5)
    for (let i = 0; i < 16; i++) {
      this.ctx.fillStyle = `hsl(${(t * 3 + i * 22) % 360} 85% 62%)`
      this.ctx.fillRect(336 + i * 4, 222, 3, 1)
      this.ctx.fillRect(336 + i * 4, 224, 3, 1)
    }
    this.px('#2a2840', 408, 222, 6, 4)
    this.px('#d8d8e8', 222, 213, 17, 13)
    this.px('#5a3020', 223, 213, 15, 2)
    this.px('#b8b8c8', 222, 224, 17, 2)
    this.text('JAVA', 223, 217, '#e06030')
    this.px('#d8d8e8', 239, 216, 3, 1)
    this.px('#d8d8e8', 241, 216, 1, 6)
    this.px('#d8d8e8', 239, 221, 3, 1)
    for (const item of this.steam) {
      const x = item.x + Math.sin((item.y + item.phase) / 5) * 1.5
      this.alpha(Math.min(0.75, item.life / 70), () => {
        if (item.bean) { this.px('#7a4a2a', x, item.y, 2, 3); this.px('#4a2a18', x + 1, item.y, 1, 3) }
        else this.px('#a8a6d0', x, item.y, 1, 2)
      })
    }
    const wobble = t % 300 < 24 ? ((t >> 2) % 2 === 1 ? 1 : -1) : 0
    this.ellipse(457 + wobble, 222, 6, 3, '#f8d848')
    this.disc(452 + wobble, 217, 3, '#f8d848')
    this.px('#f88830', 448 + wobble, 217, 2, 2)
    this.px('#101010', 451 + wobble, 216, 1, 1)
    this.cat()
    if (this.bug !== undefined) {
      const x = Math.floor(this.bug.x)
      const leg = (t >> 3) % 2
      this.px('#202020', x, 228, 6, 3)
      this.px('#e03030', x + 6, 229, 1, 1)
      this.px('#202020', x + 1 + leg, 231, 1, 1)
      this.px('#202020', x + 4 - leg, 231, 1, 1)
      this.text('NPE', x - 3, 221, '#f86858')
    }
    for (const pop of this.pops) this.alpha(Math.min(1, pop.life / 30), () => { this.text('+1 FIX', pop.x, pop.y, '#7ee0a0') })
  }

  private cat(): void {
    const awake = this.catAwake > 0 || this.pounce > 0
    const ox = this.pounce > 0 ? -3 : 0
    const oy = this.pounce > 0 ? 1 : 0
    const ear = awake ? 1 : 0
    this.ellipse(505, 222, 12, 4, '#4a4458')
    this.ellipse(505, 220, 10, 2, '#5a5468')
    this.disc(494 + ox, 219 + oy, 4, '#4a4458')
    this.px('#4a4458', 491 + ox, 213 + oy - ear, 2, 3)
    this.px('#4a4458', 496 + ox, 213 + oy - ear, 2, 3)
    if (awake) {
      this.px('#f8d860', 491 + ox, 218 + oy, 2, 2)
      this.px('#101010', 492 + ox, 218 + oy, 1, 2)
      this.px('#f8d860', 495 + ox, 218 + oy, 2, 2)
      this.px('#101010', 496 + ox, 218 + oy, 1, 2)
    } else {
      this.px('#2a2638', 492, 219, 2, 1)
      this.px('#2a2638', 496, 219, 2, 1)
    }
    for (let i = 0; i < 10; i++) this.px('#4a4458', 516 + i, 224 - Math.round(Math.sin(this.t / (awake ? 8 : 30) + i / 3) * 2 * (i / 10)), 1, 2)
    for (const z of this.zs) this.alpha(Math.min(1, z.life / 40), () => { this.text('Z', z.x, z.y, '#a8a8d8') })
  }

  private duke(): void {
    const t = this.t
    const cx = 584
    const top = 73 - (this.dukeJoy > 0 && (t >> 3) % 2 === 1 ? 3 : 0)
    for (let r = 0; r < 10; r++) {
      const half = Math.round(1 + r * 0.6)
      this.px('#141414', cx - half, top + r, half * 2 + 1, 1)
    }
    for (let r = 0; r < 7; r++) {
      const half = Math.round(7 * Math.sqrt(1 - (r / 7) ** 2))
      this.px('#f0f0f0', cx - half, top + 10 + r, half * 2 + 1, 1)
    }
    this.disc(cx, top + 10, 3, '#e02828')
    this.px('#ff9090', cx - 1, top + 8, 1, 1)
    const left = this.dukeSad > 0 ? top + 16 : top + 5 + ((t >> 4) % 2) * 2
    const right = this.dukeJoy > 0 ? top + 5 : top + 16
    this.line(cx - 6, top + 12, cx - 11, left, '#141414')
    this.disc(cx - 11, left, 1, '#f0f0f0')
    this.line(cx + 6, top + 12, cx + 9, right, '#141414')
    this.disc(cx + 9, right, 1, '#f0f0f0')
    this.px('#141414', cx - 5, top + 17, 4, 2)
    this.px('#141414', cx + 2, top + 17, 4, 2)
  }

  private rack(): void {
    const t = this.t
    const x = 548
    const y = 92
    const w = 76
    this.px('#18162c', x, y, w, 196)
    this.px('#3a3660', x, y, w, 1)
    this.px('#3a3660', x, y, 1, 196)
    this.px('#3a3660', x + w - 1, y, 1, 196)
    for (let unit = 0; unit < 10; unit++) {
      const uy = y + 6 + unit * 19
      this.px('#2a2846', x + 4, uy, w - 8, 16)
      this.px('#34325a', x + 4, uy, w - 8, 1)
      if (unit === 3) {
        this.disc(x + 14, uy + 8, 6, '#14122a')
        const angle = t * 0.35
        this.line(x + 14, uy + 8, Math.round(x + 14 + Math.cos(angle) * 5), Math.round(uy + 8 + Math.sin(angle) * 5), '#5a5880')
        this.line(x + 14, uy + 8, Math.round(x + 14 - Math.cos(angle) * 5), Math.round(uy + 8 - Math.sin(angle) * 5), '#5a5880')
      } else if (unit % 3 === 1) {
        for (let bay = 0; bay < 5; bay++) this.px('#3a3860', x + 8 + bay * 9, uy + 4, 7, 8)
      } else {
        for (let vent = 0; vent < 6; vent++) this.px('#1e1c36', x + 8, uy + 3 + vent * 2, 34, 1)
      }
      ;['#58f878', '#f8c048', '#58a8f8'].forEach((color, k) => {
        const on = ((Math.sin(t / (5 + k * 4) + unit * 1.7 + k * 2.3) * 1000) % 1 + 1) % 1 > 0.4
        this.px(on ? color : '#2a2a40', x + w - 20 + k * 5, uy + 6, 3, 3)
      })
    }
    for (const [color, start] of [['#e04858', 150], ['#58a8f8', 170], ['#f8c048', 200]] as const) {
      for (let step = 0; step <= 20; step++) {
        const u = step / 20
        this.px(color, 548 - u * 22, start + (226 - start) * u + Math.sin(u * Math.PI) * 10, 1, 2)
      }
    }
    this.duke()
  }

  private floor(): void {
    this.px('#2a1e2e', 0, 292, 640, 68)
    for (let y = 292; y < 360; y += 12) {
      this.px('#221828', 0, y, 640, 1)
      for (let x = ((y / 12) % 2) * 40; x < 640; x += 80) this.px('#221828', x, y, 1, 12)
    }
    this.ellipse(364, 314, 96, 14, '#3a2a50')
    this.ellipse(364, 314, 88, 11, '#30223f')
  }

  private developer(view: SceneView): void {
    const t = this.t
    const bob = (t / 24 | 0) % 2
    const typing = view.running > 0 && t % 600 < 480
    const left = typing ? (t >> 2) & 1 : 0
    const right = typing ? 1 - left : 0
    this.px('#3a4890', 342, 204, 46, 10)
    this.px('#4a5ab0', 344, 206, 42, 8)
    this.ellipse(365, 196 + bob, 11, 12, '#3a2418')
    this.px('#5a6a9a', 360, 185 + bob, 10, 1)
    for (let a = Math.PI; a <= 2 * Math.PI; a += 0.06) this.px('#e04858', 365 + Math.cos(a) * 12, 196 + bob + Math.sin(a) * 13, 2, 2)
    this.px('#e04858', 351, 193 + bob, 4, 9)
    this.px('#a02838', 351, 199 + bob, 4, 3)
    this.px('#e04858', 376, 193 + bob, 4, 9)
    this.px('#a02838', 376, 199 + bob, 4, 3)
    this.px('#2c2c48', 338, 212, 54, 50)
    this.px('#2c2c48', 336, 214, 58, 46)
    this.px('#3a3a5c', 338, 214, 2, 44)
    this.px('#4a5ab0', 328, 216 + left, 9, 8)
    this.px('#3a4890', 328, 222 + left, 9, 2)
    this.px('#4a5ab0', 393, 216 + right, 9, 8)
    this.px('#3a4890', 393, 222 + right, 9, 2)
    this.px('#24243c', 332, 262, 66, 8)
    this.px('#18182a', 361, 270, 8, 16)
    this.px('#18182a', 340, 286, 50, 4)
    for (const x of [340, 362, 386]) this.px('#0e0e1a', x, 290, 5, 3)
    if (view.waiting > 0 && t % 40 < 26) {
      this.px('#f8f0e0', 372, 160, 12, 16)
      this.px('#201028', 372, 160, 12, 1)
      this.text('!', 376, 165, '#e04858', 1)
      this.px('#f8f0e0', 374, 176, 3, 3)
    }
    for (const note of this.notes) {
      const x = note.x + Math.sin((note.y + note.phase) / 6) * 2
      this.alpha(Math.min(1, note.life / 40), () => {
        this.px(note.color, x, note.y, 3, 2)
        this.px(note.color, x + 2, note.y - 6, 1, 6)
        this.px(note.color, x + 3, note.y - 6, 2, 1)
      })
    }
  }

  private hud(view: SceneView): void {
    const t = this.t
    this.px('#0c0a18', 0, 0, 640, 16)
    this.px('#2a2448', 0, 15, 640, 1)
    const hh = String(view.now.getHours()).padStart(2, '0')
    const mm = String(view.now.getMinutes()).padStart(2, '0')
    this.text(`${hh}${t % 60 < 30 ? ':' : ' '}${mm}`, 8, 3, '#f0eeff', 2)
    this.text('HEAP', 72, 3, '#ff8ac8', 2)
    this.px('#2a2448', 106, 4, 60, 8)
    this.px(this.heapValue > 80 ? '#f86858' : '#ff6ac1', 107, 5, Math.round(58 * this.heapValue / 100), 6)
    this.text(`GC ${String(this.gcCount).padStart(3, '0')}`, 178, 3, '#f8d860', 2)
    this.text(`RUN ${view.running}`, 264, 3, '#7ee0a0', 2)
    this.text(`WAIT ${view.waiting}`, 336, 3, view.waiting > 0 && t % 40 < 20 ? '#f86858' : '#ff8ac8', 2)
    this.text(`DONE ${view.done}`, 416, 3, '#7ff6ff', 2)
    this.text(`FIXES ${String(this.fixes).padStart(3, '0')}`, 504, 3, '#f8a060', 2)
  }
}
