// @vitest-environment jsdom
/** Lock overlay, sidebar button, and Settings row behavior. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LockButton } from '../src/client/LockButton.tsx'
import { LockOverlay, type LockOverlayProps } from '../src/client/LockOverlay.tsx'
import { LockSettingsRow } from '../src/client/LockSettingsRow.tsx'
import type { LockPhase } from '../src/client/lock-store.ts'
import type { LockTheme } from '../src/client/theme-store.ts'

const t = ((key: string, params?: Record<string, unknown>) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`)) as LockOverlayProps['t']
const hook = <T,>(value: T) => (<R,>(selector: (state: T) => R): R => selector(value))

function overlay(phase: LockPhase, overrides: Partial<LockOverlayProps> = {}) {
  const props = {
    useLock: hook({ phase, hasPassword: phase !== 'setup' }),
    useTheme: hook('pixel'),
    useSessions: hook({ ids: ['s1' as SessionId], byId: { s1: { displayTitle: 'Build the lock' } } }),
    useSessionStatus: hook(new Map([['s1' as SessionId, { running: true, pendingInteraction: undefined, completionUnread: false }]])) as never,
    check: vi.fn(async (password: string) => password === 'right'),
    release: vi.fn(),
    setPassword: vi.fn(async () => {}),
    cancelSetup: vi.fn(),
    t,
    ...overrides,
  } as Partial<LockOverlayProps> as LockOverlayProps
  render(<LockOverlay {...props} />)
  return props
}

type ButtonProps = Parameters<typeof LockButton>[0]
type RowProps = Parameters<typeof LockSettingsRow>[0]
const buttonProps = (wide: boolean, lock: () => void): ButtonProps => ({ wide, lock, t } as Partial<ButtonProps> as ButtonProps)
const rowProps = (
  hasPassword: boolean, lock: () => void, removePassword: () => void,
  changePassword: () => void = () => {}, setTheme: (theme: LockTheme) => void = () => {},
): RowProps => ({
  useLock: hook({ phase: 'unlocked' as const, hasPassword }), useTheme: hook<LockTheme>('pixel'),
  lock, changePassword, removePassword, setTheme, t,
} as Partial<RowProps> as RowProps)
const dialog = (): HTMLElement => screen.getByRole('dialog')
const input = (): HTMLInputElement => screen.getByLabelText('input.label')
const type = (text: string): void => { fireEvent.change(input(), { target: { value: text } }) }
const submit = async (): Promise<void> => { await act(async () => { fireEvent.submit(input().closest('form')!) }) }

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('LockOverlay', () => {
  it('renders nothing while unlocked', () => {
    overlay('unlocked')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows live agent status and blocks shortcuts as a modal', () => {
    overlay('locked')
    expect(dialog().dataset.shortcutModal).toBe('lock-screen')
    expect(screen.getByText('status.running {"title":"Build the lock"}')).toBeTruthy()
    expect(screen.getByText('pressStart')).toBeTruthy()
  })

  it('unlocks after a wrong attempt shows the stack trace', async () => {
    const props = overlay('locked')
    fireEvent.keyDown(dialog(), { key: 'Shift' })
    expect(screen.queryByLabelText('input.label')).toBeNull()
    fireEvent.keyDown(dialog(), { key: 'x', ctrlKey: true })
    expect(screen.queryByLabelText('input.label')).toBeNull()
    fireEvent.keyDown(dialog(), { key: 'a' })
    await submit()
    expect(screen.getByRole('alert').textContent).toBe('error.empty')
    type('wrong')
    await submit()
    expect(props.check).toHaveBeenCalledWith('wrong')
    expect(screen.getByText('error.wrong.3 {"count":1}')).toBeTruthy()
    type('right')
    expect(screen.getByText('error.wrong.1')).toBeTruthy()
    await submit()
    expect(screen.getByText('ok.title')).toBeTruthy()
    await waitFor(() => { expect(props.release).toHaveBeenCalled() }, { timeout: 3000 })
  })

  it('returns to the title on Escape and opens the prompt on pointer down', () => {
    overlay('locked')
    fireEvent.pointerDown(dialog())
    expect(input()).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByLabelText('input.label')).toBeNull()
  })

  it('toggles full screen with F on the title', () => {
    const request = vi.fn(async () => {})
    const exit = vi.fn(async () => {})
    document.documentElement.requestFullscreen = request
    document.exitFullscreen = exit
    overlay('locked')
    fireEvent.keyDown(dialog(), { key: 'f' })
    expect(request).toHaveBeenCalled()
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body })
    fireEvent.keyDown(dialog(), { key: 'F' })
    expect(exit).toHaveBeenCalled()
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  })

  it('sets a first password after a matching confirmation', async () => {
    const props = overlay('setup')
    expect(screen.getByText('prompt.setup')).toBeTruthy()
    type('one')
    await submit()
    expect(screen.getByText('prompt.confirm')).toBeTruthy()
    type('two')
    await submit()
    expect(screen.getByRole('alert').textContent).toBe('error.mismatch')
    type('one')
    await submit()
    type('one')
    await submit()
    expect(props.setPassword).toHaveBeenCalledWith('one')
  })

  it('asks for a replacement password when changing it', async () => {
    const props = overlay('change')
    expect(screen.getByText('prompt.change')).toBeTruthy()
    type('new')
    await submit()
    type('new')
    await submit()
    expect(props.setPassword).toHaveBeenCalledWith('new')
  })

  it('cancels the first-password step on Escape', () => {
    const props = overlay('setup')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.cancelSetup).toHaveBeenCalled()
  })

  it('animates the scene on a canvas and refits on resize', () => {
    const fills: string[] = []
    const ctx = new Proxy({}, {
      get: (target: Record<string, unknown>, key: string) => key in target ? target[key] : () => { fills.push(key) },
      set: (target: Record<string, unknown>, key: string, value: unknown) => { target[key] = value; return true },
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
    let frames = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      if (++frames < 3) callback(performance.now() + frames * 40)
      return frames
    })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList)
    overlay('locked')
    expect(fills).toContain('fillRect')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    fireEvent(window, new Event('resize'))
    const stage = dialog().firstElementChild as HTMLElement
    expect(stage.style.width).toBe('320px')
    cleanup()
    expect(cancel).toHaveBeenCalled()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  })

  it('ignores a second submit while checking and keeps the prompt on pointer down', async () => {
    let resolve: (value: boolean) => void = () => {}
    const props = overlay('locked', { check: vi.fn(() => new Promise<boolean>((done) => { resolve = done })) })
    fireEvent.keyDown(dialog(), { key: 'Enter' })
    fireEvent.pointerDown(dialog())
    type('slow')
    await submit()
    expect(screen.getByText('checking')).toBeTruthy()
    await submit()
    expect(props.check).toHaveBeenCalledTimes(1)
    await act(async () => { resolve(false) })
    expect(screen.getByText('error.wrong.3 {"count":1}')).toBeTruthy()
  })

  it('swallows a refused full-screen request', async () => {
    document.documentElement.requestFullscreen = vi.fn(async () => { throw new Error('denied') })
    const denied = vi.fn(async () => { throw new Error('denied') })
    document.exitFullscreen = denied
    overlay('locked')
    fireEvent.keyDown(dialog(), { key: 'f' })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body })
    fireEvent.keyDown(dialog(), { key: 'f' })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    await act(async () => {})
    expect(denied).toHaveBeenCalled()
  })

  it('names waiting, finished, and idle agents', () => {
    const pending = { key: 'k', kind: 'approval', sessionId: 's1' as SessionId }
    overlay('locked', { useSessionStatus: hook(new Map([['s1' as SessionId, { running: true, pendingInteraction: pending, completionUnread: false }]])) as never })
    expect(screen.getByText('status.waiting {"title":"Build the lock"}')).toBeTruthy()
    cleanup()
    overlay('locked', { useSessionStatus: hook(new Map([['s1' as SessionId, { running: false, pendingInteraction: undefined, completionUnread: true }]])) })
    expect(screen.getByText('status.done {"title":"Build the lock"}')).toBeTruthy()
    cleanup()
    overlay('locked', { useSessionStatus: hook(new Map()) as never })
    expect(screen.getByText('status.idle')).toBeTruthy()
    cleanup()
    const running = { running: true, pendingInteraction: undefined, completionUnread: false }
    overlay('locked', { useSessionStatus: hook(new Map([['s1' as SessionId, running], ['s2' as SessionId, running]])) })
    expect(screen.getByText('status.runningMore {"title":"Build the lock","count":1}')).toBeTruthy()
  })
})

describe('LockOverlay in the Matrix style', () => {
  const matrix = (phase: LockPhase, overrides: Partial<LockOverlayProps> = {}) =>
    overlay(phase, { useTheme: hook<LockTheme>('matrix'), ...overrides })

  it('opens on the login form under the agent status and grants access after a denied attempt', async () => {
    const props = matrix('locked')
    expect(screen.getByText('matrix.bar')).toBeTruthy()
    expect(screen.getByText('matrix.wake')).toBeTruthy()
    expect(screen.getByText('status.running {"title":"Build the lock"}')).toBeTruthy()
    expect(screen.queryByText('pressStart')).toBeNull()
    expect(document.activeElement).toBe(input())
    expect(screen.getByText('matrix.hint')).toBeTruthy()
    type('wrong')
    await submit()
    expect(screen.getByText('matrix.denied.1')).toBeTruthy()
    expect(screen.getByText('matrix.denied.2 {"count":1}')).toBeTruthy()
    expect(screen.queryByText('error.wrong.1')).toBeNull()
    type('right')
    await submit()
    expect(screen.getByText('matrix.ok.title')).toBeTruthy()
    expect(screen.getByText('matrix.ok.detail')).toBeTruthy()
    await waitFor(() => { expect(props.release).toHaveBeenCalled() }, { timeout: 3000 })
  })

  it('clears the field on Escape and keeps the form open', () => {
    matrix('locked')
    type('half')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(input().value).toBe('')
  })

  it('takes full screen on a key or a click and leaves it when the page uncovers', () => {
    const request = vi.fn(async () => {})
    const exit = vi.fn(async () => {})
    document.documentElement.requestFullscreen = request
    document.exitFullscreen = exit
    matrix('locked')
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(request).not.toHaveBeenCalled()
    fireEvent.keyDown(input(), { key: 'a' })
    fireEvent.pointerDown(dialog())
    expect(request).toHaveBeenCalledTimes(2)
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body })
    fireEvent.pointerDown(dialog())
    expect(request).toHaveBeenCalledTimes(2)
    cleanup()
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('ignores refused full-screen requests and asks no first password under the status', async () => {
    document.documentElement.requestFullscreen = vi.fn(async () => { throw new Error('denied') })
    const exit = vi.fn(async () => { throw new Error('gone') })
    document.exitFullscreen = exit
    matrix('setup')
    expect(screen.queryByText('matrix.wake')).toBeNull()
    expect(screen.getByText('prompt.setup')).toBeTruthy()
    fireEvent.pointerDown(dialog())
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body })
    cleanup()
    await act(async () => {})
    expect(exit).toHaveBeenCalled()
  })

  it('stays windowed where the browser offers no full screen', () => {
    const request = vi.fn(async () => {})
    document.documentElement.requestFullscreen = request
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false })
    matrix('locked')
    fireEvent.pointerDown(dialog())
    expect(request).not.toHaveBeenCalled()
  })

  it('sizes the rain canvas to the device viewport', () => {
    const calls: string[] = []
    const ctx = new Proxy({}, {
      get: (target: Record<string, unknown>, key: string) => key in target ? target[key] : () => { calls.push(key) },
      set: (target: Record<string, unknown>, key: string, value: unknown) => { target[key] = value; return true },
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
    let frames = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      if (++frames < 3) callback(performance.now() + frames * 40)
      return frames
    })
    window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList)
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0 })
    matrix('locked')
    const canvas = dialog().querySelector('canvas')!
    expect(canvas.width).toBe(window.innerWidth)
    expect(canvas.height).toBe(window.innerHeight)
    expect(calls).toContain('fillText')
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
  })
})

describe('LockButton', () => {
  it('locks from both sidebar widths', () => {
    const lock = vi.fn()
    const { rerender } = render(<LockButton {...buttonProps(true, lock)} />)
    fireEvent.click(screen.getByRole('button', { name: 'button' }))
    rerender(<LockButton {...buttonProps(false, lock)} />)
    fireEvent.click(screen.getByRole('button', { name: 'button' }))
    expect(lock).toHaveBeenCalledTimes(2)
  })
})

describe('LockSettingsRow', () => {
  it('sets, changes, and removes the password, and locks', () => {
    const lock = vi.fn()
    const removePassword = vi.fn()
    const changePassword = vi.fn()
    const { rerender } = render(<LockSettingsRow {...rowProps(false, lock, removePassword, changePassword)} />)
    expect(screen.queryByText('settings.remove')).toBeNull()
    fireEvent.click(screen.getByText('settings.setPassword'))
    fireEvent.click(screen.getByText('settings.lockNow'))
    rerender(<LockSettingsRow {...rowProps(true, lock, removePassword, changePassword)} />)
    fireEvent.click(screen.getByText('settings.change'))
    fireEvent.click(screen.getByText('settings.remove'))
    expect(lock).toHaveBeenCalled()
    expect(changePassword).toHaveBeenCalledTimes(2)
    expect(removePassword).toHaveBeenCalled()
  })

  it('picks the lock screen style', () => {
    const setTheme = vi.fn()
    render(<LockSettingsRow {...rowProps(true, () => {}, () => {}, () => {}, setTheme)} />)
    expect(screen.getByRole('tablist', { name: 'settings.theme' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'theme.matrix' }))
    expect(setTheme).toHaveBeenCalledWith('matrix')
  })
})
