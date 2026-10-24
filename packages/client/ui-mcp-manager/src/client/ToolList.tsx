/** The tools one MCP server provides. */
import type { ReactNode } from 'react'
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
  if (tools.length === 0) return <p className={css.hint}>{t('noTools')}</p>
  return (
    <ul className={css.tools}>
      {tools.map(tool => (
        <li key={tool.publicName} className={css.tool}>
          <code className={css.toolName}>{tool.publicName}</code>
          {tool.title === undefined ? null : <span>{tool.title}</span>}
          {tool.description === '' ? null : <span className={css.hint}>{tool.description}</span>}
        </li>
      ))}
    </ul>
  )
}
