/** The Activity tab's chip title: a gauge glyph before the type's label. */
import type { ReactNode } from 'react'
import { IconGaugeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import css from './ActivityPanel.module.css'

/**
 * The title as the chip and a floating panel's header show it.
 * @param props - the tab information hook.
 * @returns the gauge glyph followed by the tab's title text.
 */
export function ActivityTitle({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>): ReactNode {
  const { tab } = useTabInfo()
  return (
    <>
      <IconGaugeOutlineRegular size={16} className={css.titleIcon} />
      {tab.title}
    </>
  )
}
