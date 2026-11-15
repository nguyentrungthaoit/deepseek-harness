// @vitest-environment jsdom
/** The chip title: a gauge glyph, then the type's label. */
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ActivityTitle } from '../src/client/ActivityTitle.tsx'

afterEach(cleanup)

it('draws the gauge glyph before the title text', () => {
  const props = { useTabInfo: () => ({ tab: { title: 'Activity' } }) } as PropsRuntime<'sidebar.right.pane.tab.title'>
  const { container } = render(<ActivityTitle {...props} />)
  expect(container.querySelector('svg')?.getAttribute('width')).toBe('16')
  expect(container.textContent).toBe('Activity')
})
