/** The tools one MCP server provides. */
import type { ReactNode } from 'react'
import { IconSettingsOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpToolView } from '@deepseek-ai/dsh-mcp-manager/types'
import css from './McpPanel.module.css'

/**
 * @param props.tools - the discovered tools.
 * @param props.t - panel copy.
 * @returns the tool list, or the empty line.
 */
export function ToolList(props: {
  tools: readonly McpToolView[]
  t: TranslateNS<'mcpManager'>
}): ReactNode {
  const { tools, t } = props
  if (tools.length === 0) return <p className={`${css.card} ${css.emptyTools}`}>{t('noTools')}</p>
  return (
    <ul className={css.tools}>
      {tools.map((tool) => {
        const heading = tool.title ?? tool.rawName
        return (
          <li key={tool.publicName} className={css.tool}>
            <span className={css.toolIcon}><IconSettingsOutlineRegular size={14} /></span>
            <span className={css.toolMain}>
              <span className={css.toolTitle}>{heading}</span>
              {tool.publicName === heading ? null : <code className={css.toolName}>{tool.publicName}</code>}
              {tool.description === '' ? null : <span className={css.toolDescription}>{tool.description}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
