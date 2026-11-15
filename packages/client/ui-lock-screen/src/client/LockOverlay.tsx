/**
 * Full-viewport lock overlay in the chosen style. The pixel style draws its
 * scene on a canvas scaled by whole multiples where the viewport allows; the
 * Matrix style draws code rain at device resolution behind a centered
 * terminal login form, keeps the page in browser full screen while locked, and
 * leaves full screen when the page uncovers. Both keep the status line, the password field, and messages in a
 * DOM dialog, so localized text and Session titles keep the system font. The overlay is an `aria-modal` dialog with its own shortcut
 * modal id, so application shortcuts stay blocked while it is open.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { summarizeAgents, type AgentLine } from './agent-status.ts'
import type { LockPhase, LockState } from './lock-store.ts'
import type { NS } from './locales.ts'
import { enterFullscreen, exitFullscreen, toggleFullscreen } from './fullscreen.ts'
import { MATRIX_CELL, MatrixRain } from './matrix.ts'
import { PixelScene, SCENE_HEIGHT, SCENE_WIDTH, type SceneView } from './scene.ts'
import type { LockTheme } from './theme-store.ts'
import pixelCss from './LockOverlay.module.css'
import matrixCss from './MatrixOverlay.module.css'

/** Lock state and transitions supplied by the plugin. */
export interface LockOverlayInjected {
  hooks: { lock: ObservableSnapshot<LockState>; theme: ObservableSnapshot<LockTheme> }
  /** @param password - candidate text. @returns whether it matches the stored password. */
  check(password: string): Promise<boolean>
  /** Uncover the page after a successful check. */
  release(): void
  /** @param password - new password; a first one locks, a changed one uncovers the page. */
  setPassword(password: string): Promise<void>
  /** Leave the first-password or change-password step. */
  cancelSetup(): void
}

/** Full props of the `shell.overlay` entry. */
export type LockOverlayProps = PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS> & InjectFace<LockOverlayInjected>

/** Milliseconds the BUILD SUCCESS message shows before the page uncovers. */
const RELEASE_DELAY_MS = 1200
const STEP_MS = 1000 / 60

/**
 * Render nothing while unlocked; otherwise the lock screen in a body portal.
 * @param props - composed slot props.
 * @returns the portal, or null.
 */
export function LockOverlay(props: LockOverlayProps): ReactNode {
  const phase = props.useLock(state => state.phase)
  const theme = props.useTheme(state => state)
  if (phase === 'unlocked') return null
  return createPortal(<LockScreen {...props} phase={phase} theme={theme} />, document.body)
}

/** One style's animation, stepped and painted by the overlay's frame loop. */
interface Painter {
  tick(view: SceneView): void
  render(view: SceneView): void
}

function pixelPainter(ctx: CanvasRenderingContext2D, reducedMotion: boolean): Painter {
  const scene = new PixelScene(Math.random, reducedMotion, () => document.createElement('canvas'))
  return { tick: (view) => { scene.tick(view) }, render: (view) => { scene.render(ctx, view) } }
}

function matrixPainter(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, reducedMotion: boolean): Painter {
  const rain = new MatrixRain(Math.random, reducedMotion)
  return {
    tick: (view) => { rain.tick(view) },
    render: () => {
      const ratio = window.devicePixelRatio || 1
      const width = Math.round(window.innerWidth * ratio)
      const height = Math.round(window.innerHeight * ratio)
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      rain.render(ctx, width, height, Math.round(MATRIX_CELL * ratio))
    },
  }
}

type Mode = 'title' | 'input'
type Failure = 'empty' | 'mismatch' | 'wrong' | undefined

function LockScreen({ phase, theme, useSessions, useSessionStatus, check, release, setPassword, cancelSetup, t }:
  LockOverlayProps & { phase: Exclude<LockPhase, 'unlocked'>; theme: LockTheme }): ReactNode {
  const matrix = theme === 'matrix'
  const css = matrix ? matrixCss : pixelCss
  const sessions = useSessions(state => state)
  const status = useSessionStatus(state => state)
  const summary = useMemo(() => summarizeAgents(sessions, status), [sessions, status])
  const choosing = phase === 'setup' || phase === 'change'
  // The Matrix style has no title screen: its terminal opens on the form.
  const [mode, setMode] = useState<Mode>(choosing || matrix ? 'input' : 'title')
  const [step, setStep] = useState<'first' | 'confirm'>('first')
  const [value, setValue] = useState('')
  const [failure, setFailure] = useState<Failure>(undefined)
  const [fails, setFails] = useState(0)
  const [shakes, setShakes] = useState(0)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [scale, setScale] = useState(1)
  const first = useRef('')
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const view = useRef<Omit<SceneView, 'now'>>(summary)
  view.current = summary

  useEffect(() => {
    if (!choosing) { setStep('first'); first.current = '' }
    setMode(choosing || matrix ? 'input' : 'title')
    setValue('')
    setFailure(undefined)
  }, [phase, choosing, matrix])

  useEffect(() => matrix ? () => { exitFullscreen(document) } : undefined, [matrix])

  useLayoutEffect(() => {
    const fit = (): void => {
      const next = Math.min(window.innerWidth / SCENE_WIDTH, window.innerHeight / SCENE_HEIGHT)
      setScale(next >= 1 ? Math.floor(next) : next)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit) }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas === null || ctx === null || ctx === undefined) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const scene = matrix ? matrixPainter(canvas, ctx, reducedMotion) : pixelPainter(ctx, reducedMotion)
    let last = performance.now()
    let pending = 0
    let frame = 0
    const loop = (now: number): void => {
      pending += Math.min(now - last, 100)
      last = now
      const facts: SceneView = { ...view.current, now: new Date() }
      for (; pending >= STEP_MS; pending -= STEP_MS) scene.tick(facts)
      scene.render(facts)
      frame = window.requestAnimationFrame(loop)
    }
    frame = window.requestAnimationFrame(loop)
    return () => { window.cancelAnimationFrame(frame) }
  }, [matrix])

  useEffect(() => {
    if (!success) return
    const timer = window.setTimeout(release, RELEASE_DELAY_MS)
    return () => { window.clearTimeout(timer) }
  }, [success, release])

  useEffect(() => {
    if (mode === 'input') inputRef.current?.focus()
    else rootRef.current?.focus()
  }, [mode, step])

  useModalLayer(rootRef, true, () => {
    if (choosing) { cancelSetup(); return }
    setMode(matrix ? 'input' : 'title')
    setValue('')
    setFailure(undefined)
  })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // A reload drops full screen; the first key typed at the form restores it.
    if (matrix && event.key !== 'Escape') enterFullscreen(document)
    if (mode !== 'title' || success || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault()
      toggleFullscreen(document)
      return
    }
    if (event.key.length === 1 || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setMode('input')
    }
  }

  const fail = (reason: Exclude<Failure, undefined>): void => {
    setFailure(reason)
    setValue('')
    setShakes(count => count + 1)
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    if (value.length === 0) { fail('empty'); return }
    if (choosing) {
      if (step === 'first') {
        first.current = value
        setStep('confirm')
        setValue('')
        setFailure(undefined)
        return
      }
      if (value !== first.current) {
        first.current = ''
        setStep('first')
        fail('mismatch')
        return
      }
      setBusy(true)
      await setPassword(value).finally(() => { setBusy(false) })
      return
    }
    setBusy(true)
    const matched = await check(value).finally(() => { setBusy(false) })
    if (matched) { setFailure(undefined); setSuccess(true); return }
    setFails(count => count + 1)
    fail('wrong')
  }

  const firstPrompt = phase === 'change' ? 'prompt.change' : 'prompt.setup'
  const prompt = choosing ? t(step === 'first' ? firstPrompt : 'prompt.confirm') : t('prompt.unlock')
  const text = lineText(summary.line, t)
  const header = <>
    <div className={css.tab}>{t('tab.agent')}</div>
    {matrix && <div className={css.wake}>{t('matrix.wake')}</div>}
    <div key={text} className={`${css.line} ${css[summary.line.kind]}`}>{text}</div>
    <div className={css.summary}>{t('summary', { running: summary.running, waiting: summary.waiting, done: summary.done })}</div>
  </>
  const unlockHint = matrix ? 'matrix.hint' : 'hint.unlock'
  let dialog: ReactNode
  if (success) {
    dialog = <div className={css.ok}>
      <div className={css.okTitle}>{t(matrix ? 'matrix.ok.title' : 'ok.title')}</div>
      <div>{t(matrix ? 'matrix.ok.detail' : 'ok.detail')}</div>
    </div>
  } else if (mode === 'title') {
    dialog = <>
      {header}
      <div className={css.press}>{t('pressStart')}</div>
    </>
  } else {
    const form = <form key={shakes} className={shakes > 0 ? css.shake : undefined} onSubmit={(event) => { void submit(event) }}>
      {failure === 'wrong' && (matrix
        ? <div className={css.trace}>
          <div className={css.error}>{t('matrix.denied.1')}</div>
          <div className={css.cause}>{t('matrix.denied.2', { count: fails })}</div>
        </div>
        : <div className={css.trace}>
          <div className={css.error}>{t('error.wrong.1')}</div>
          <div>{t('error.wrong.2')}</div>
          <div className={css.cause}>{t('error.wrong.3', { count: fails })}</div>
        </div>)}
      <label className={css.prompt} htmlFor="dsh-lock-screen-password">{prompt}</label>
      <input
        ref={inputRef}
        id="dsh-lock-screen-password"
        className={css.input}
        type="password"
        autoComplete={choosing ? 'new-password' : 'current-password'}
        aria-label={t('input.label')}
        aria-invalid={failure !== undefined}
        data-modal-autofocus
        disabled={busy}
        value={value}
        onChange={(event) => { setValue(event.target.value); if (failure !== 'wrong') setFailure(undefined) }}
      />
      {failure === 'empty' && <div className={css.error} role="alert">{t('error.empty')}</div>}
      {failure === 'mismatch' && <div className={css.error} role="alert">{t('error.mismatch')}</div>}
      <div className={css.hint}>{busy ? t('checking') : t(choosing ? 'hint.setup' : unlockHint)}</div>
    </form>
    dialog = matrix && !choosing ? <><div className={css.status}>{header}</div>{form}</> : form
  }

  return (
    <div
      ref={rootRef}
      className={css.root}
      role="dialog"
      aria-modal="true"
      aria-label={t('dialog.label')}
      data-shortcut-modal="lock-screen"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={() => {
        if (matrix) enterFullscreen(document)
        if (mode === 'title' && !success) setMode('input')
      }}
    >
      {matrix ? <>
        <canvas key="matrix" ref={canvasRef} className={css.canvas} aria-hidden="true" />
        <div className={css.terminal}>
          <div className={css.bar}>{t('matrix.bar')}</div>
          <div className={css.dialog}>{dialog}</div>
        </div>
      </> : <div className={css.stage} style={{ width: SCENE_WIDTH * scale, height: SCENE_HEIGHT * scale }}>
        <canvas key="pixel" ref={canvasRef} className={css.canvas} width={SCENE_WIDTH} height={SCENE_HEIGHT} aria-hidden="true" />
        <div className={css.layer} style={{ transform: `scale(${scale})` }}>
          <div className={css.dialog}>{dialog}</div>
        </div>
      </div>}
    </div>
  )
}

function lineText(line: AgentLine, t: LockOverlayProps['t']): string {
  if (line.kind === 'idle') return t('status.idle')
  if (line.kind === 'waiting') return t('status.waiting', { title: line.title })
  if (line.kind === 'done') return t('status.done', { title: line.title })
  return line.more > 0 ? t('status.runningMore', { title: line.title, count: line.more }) : t('status.running', { title: line.title })
}
