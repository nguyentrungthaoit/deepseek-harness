/**
 * The skills type's chip title: a document glyph before the type's label.
 */
import type { ReactNode } from 'react'
import { IconDeliverDocRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Panel.module.css'

/**
 * The title as the chip and a floating panel's header show it.
 * @param props - the tab information hook.
 * @returns the document glyph followed by the tab's title text.
 */
export function SkillManagerTitle({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>): ReactNode {
  const { tab } = useTabInfo()
  return (
    <>
      <IconDeliverDocRegular size={16} className={css.titleIcon} />
      {tab.title}
    </>
  )
}
