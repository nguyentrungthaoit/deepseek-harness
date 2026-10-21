// @vitest-environment jsdom
/** The Skills toast: its registration-level store and the overlay entry. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en } from '../src/client/locales.ts'
import { createSkillToastSource, failureToast, SkillManagerToast } from '../src/client/SkillToast.tsx'
import type { SkillToastProps, SkillToastState } from '../src/client/SkillToast.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function mount(state: SkillToastState | null, dismiss = vi.fn()) {
  const props = {
    useToast: (select: (value: SkillToastState | null) => SkillToastState | null) => select(state),
    dismiss,
    t: makeTranslate(en),
  } as SkillToastProps
  return render(<SkillManagerToast {...props} />)
}

describe('skill toast source', () => {
  it('numbers each notice and clears on dismiss', () => {
    const source = createSkillToastSource()
    expect(source.hooks.toast.getSnapshot()).toBeNull()
    source.notify({ kind: 'saved', name: 'field-list' })
    source.notify({ kind: 'saved', name: 'field-list' })
    expect(source.hooks.toast.getSnapshot()).toEqual({ kind: 'saved', name: 'field-list', seq: 2 })
    source.dismiss()
    expect(source.hooks.toast.getSnapshot()).toBeNull()
  })

  it('turns a failure into a conflict or the given kind with the host message', () => {
    expect(failureToast('deleteFailed', 'a', { message: 'stale', conflict: true })).toEqual({ kind: 'conflict', name: 'a' })
    expect(failureToast('saveFailed', 'a', { message: 'locked', conflict: false }))
      .toEqual({ kind: 'saveFailed', name: 'a', message: 'locked' })
  })
})

describe('SkillManagerToast', () => {
  it('renders nothing without a notice', () => {
    expect(mount(null).container.textContent).toBe('')
  })

  it('shows success and failure copy and dismisses after the hold', () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    mount({ kind: 'subagentOn', name: 'field-list', seq: 1 }, dismiss)
    expect(document.body.textContent).toContain('Subagent on for field-list')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(dismiss).toHaveBeenCalled()
    cleanup()
    mount({ kind: 'deleteFailed', name: 'field-list', message: 'busy', seq: 2 })
    expect(document.body.textContent).toContain("Couldn't delete field-list. busy")
    cleanup()
    mount({ kind: 'conflict', name: 'field-list', seq: 3 })
    expect(document.body.textContent).toContain('field-list changed on disk. Reload to see the latest version.')
  })
})
