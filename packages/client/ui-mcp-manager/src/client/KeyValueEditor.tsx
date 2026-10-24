/**
 * Editor for `env` or `headers` entries. A stored entry renders as a
 * write-only secret field whose blank value keeps the stored one; a new entry
 * takes a key and a value. Values are never prefilled.
 */
import { useId, type ReactNode } from 'react'
import { IconPlusOutlineRegular, IconTrashOutlineRegular, Input, SettingsSecretField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SecretRow } from './form-model.ts'
import type {} from './locales.ts'
import css from './McpPanel.module.css'

/**
 * @param props.label - the section label.
 * @param props.rows - current entries.
 * @param props.disabled - disables every control while saving.
 * @param props.onChange - receives the next entries.
 * @param props.t - panel copy.
 * @returns the labelled entry list with add and remove controls.
 */
export function KeyValueEditor(props: {
  label: string
  rows: readonly SecretRow[]
  disabled: boolean
  onChange: (rows: SecretRow[]) => void
  t: TranslateNS<'mcpManager'>
}): ReactNode {
  const { rows, t } = props
  const id = useId()
  const update = (index: number, next: Partial<SecretRow>): void => {
    props.onChange(rows.map((row, at) => at === index ? { ...row, ...next } : row))
  }
  return (
    <fieldset className={css.section} disabled={props.disabled}>
      <legend className={css.sectionTitle}>
        {props.label}
        {rows.length === 0 ? null : <span className={css.count}>{rows.length}</span>}
      </legend>
      <div className={`${css.card} ${css.entries}`}>
        {rows.map((row, index) => (
          <div key={row.stored ? `stored:${row.key}` : `new:${String(index)}`} className={css.entry}>
            {row.stored
              ? (
                <div className={css.entryStored}>
                  <SettingsSecretField
                    id={`${id}-${String(index)}`} label={row.key} hint={t('form.secretStored')} text={row.value}
                    configured stateLabel={t('form.secretStored')} disabled={props.disabled}
                    onEdit={(value) => { update(index, { value }) }}
                  />
                </div>
              )
              : (
                <>
                  <Input className={css.mono ?? ''} aria-label={t('form.key')} placeholder={t('form.key')} value={row.key} onChange={(event) => { update(index, { key: event.target.value }) }} />
                  <Input aria-label={t('form.value')} placeholder={t('form.value')} type="password" autoComplete="new-password" value={row.value} onChange={(event) => { update(index, { value: event.target.value }) }} />
                </>
              )}
            <button type="button" className={css.removeEntry} onClick={() => { props.onChange(rows.filter((_row, at) => at !== index)) }}>
              <IconTrashOutlineRegular size={14} />
              <span className={css.srOnly}>{t('form.removeEntry')}</span>
            </button>
          </div>
        ))}
        <button type="button" className={css.addEntry} onClick={() => { props.onChange([...rows, { key: '', stored: false, value: '' }]) }}>
          <IconPlusOutlineRegular size={14} />
          {t('form.addEntry')}
        </button>
      </div>
    </fieldset>
  )
}
