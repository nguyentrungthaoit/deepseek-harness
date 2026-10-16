// @vitest-environment jsdom
/** The chip title: a document glyph, then the type's label. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SkillManagerTitle } from '../src/client/Title.tsx'

afterEach(cleanup)

function props(title: string): PropsRuntime<'sidebar.right.pane.tab.title'> {
  const face = { useTabInfo: () => ({ tab: { title } }) }
  return face as PropsRuntime<'sidebar.right.pane.tab.title'>
}

describe('SkillManagerTitle', () => {
  it('draws the document glyph before the title text', () => {
    const { container } = render(<SkillManagerTitle {...props('Rules and skills')} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('16')
    expect(container.textContent).toBe('Rules and skills')
  })
})
