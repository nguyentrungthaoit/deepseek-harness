/** Narrow band of glyphs falling from the streaming reasoning text while the model thinks. */
import { memo, useEffect, useRef, useState } from 'react'
import type { UseChat } from '../contract/slots.ts'
import { RainField, rainGlyphs } from './reasoning-rain.ts'
import css from './ReasoningRain.module.css'

/** Longest step one frame may advance, so a stalled frame does not jump the field. */
const MAX_FRAME_MS = 100

function reducedMotion(): boolean {
  return typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Animate the band on one canvas. Frames are requested only while the document is
 * visible; under reduced motion, or where motion preference cannot be read, nothing renders.
 * Mount only while the model is thinking.
 * @param props - Chat snapshot selector supplying the reasoning text.
 * @returns the decorative canvas, or null under reduced motion.
 */
export const ReasoningRain = memo(function ReasoningRain(props: { useChat: UseChat }) {
  const source = props.useChat(s => rainGlyphs(s.legacy.partial))
  const [reduced] = useState(reducedMotion)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glyphs = useRef(source)
  useEffect(() => { glyphs.current = source }, [source])
  useEffect(() => {
    const canvas = canvasRef.current
    const painter = canvas?.getContext('2d')
    if (canvas == null || painter == null) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const scale = Math.max(1, window.devicePixelRatio)
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    painter.scale(scale, scale)
    const style = getComputedStyle(canvas)
    painter.fillStyle = style.color
    painter.font = `${style.fontSize} ${style.fontFamily}`
    const field = new RainField(width, height, Math.random)
    let frame = 0
    let last: number | null = null
    const tick = (at: number): void => {
      field.advance(last === null ? 0 : Math.min(at - last, MAX_FRAME_MS), glyphs.current)
      last = at
      field.draw(painter)
      frame = requestAnimationFrame(tick)
    }
    const sync = (): void => {
      cancelAnimationFrame(frame)
      last = null
      if (document.visibilityState === 'visible') frame = requestAnimationFrame(tick)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      cancelAnimationFrame(frame)
    }
  }, [])
  if (reduced) return null
  return <canvas ref={canvasRef} className={css.rain} aria-hidden="true" data-reasoning-rain />
})
