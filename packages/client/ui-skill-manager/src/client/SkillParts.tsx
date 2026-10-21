/**
 * Pieces the detail page and the form share: the rendered skill document and
 * the Subagent row.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillManagerBodyProps } from './Panel.tsx'
import css from './Panel.module.css'

/**
 * A skill body rendered as Markdown inside a bordered document surface.
 * @param props.text - the skill body; empty text shows the empty line instead.
 * @param props.t - the tab's translate, also used for code-block and footnote chrome.
 * @returns the document surface.
 */
export function SkillDocument({ text, t }: { text: string; t: SkillManagerBodyProps['t'] }): ReactNode {
  const labels = useMemo(() => ({
    code: {
      copyLabel: t('copy'),
      copiedLabel: t('copied'),
      toolbarLabels: { codeLabel: t('codeBlock.title'), wrapLabel: t('codeBlock.wrap'), unwrapLabel: t('codeBlock.unwrap') },
    },
    footnotes: t('markdown.footnotes'),
  }), [t])
  return (
    <div className={css.document}>
      {text.trim() === ''
        ? <p className={css.muted}>{t('body.empty')}</p>
        : <MarkdownText text={text} labels={labels} />}
    </div>
  )
}

/**
 * The Subagent title, its explanation, and its switch on one row.
 * @param props.label - the switch's accessible name.
 * @param props.checked - the shown state.
 * @param props.disabled - whether a write is in flight.
 * @param props.onChange - called with the requested state.
 * @param props.t - the tab's translate.
 * @returns the row.
 */
export function SubagentRow({ label, checked, disabled = false, onChange, t }: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  t: SkillManagerBodyProps['t']
}): ReactNode {
  return (
    <div className={css.switchRow}>
      <div className={css.switchText}>
        <h3 className={css.switchTitle}>{t('section.subagent')}</h3>
        <p className={css.hint}>{t('subagent.help')}</p>
      </div>
      <Switch className={css.toggle} checked={checked} disabled={disabled} label={label} onChange={onChange} />
    </div>
  )
}
