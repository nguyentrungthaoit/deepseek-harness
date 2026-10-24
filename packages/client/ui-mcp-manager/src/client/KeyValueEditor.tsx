/**
 * Editor for `env` or `headers` entries. A stored entry renders as a
 * write-only secret field whose blank value keeps the stored one; a new entry
 * takes a key and a value. Values are never prefilled.
 */
import { useId, type ReactNode } from 'react'
import { Button, Input, SettingsSecretField } from '@deepseek-ai/dsh-client-ui-primitives'
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
    <fieldset className={css.entries} disabled={props.disabled}>
      <legend className={css.label}>{props.label}</legend>
      {rows.map((row, index) => (
        <div key={row.stored ? `stored:${row.key}` : `new:${String(index)}`} className={css.entry}>
          {row.stored
            ? (
              <SettingsSecretField
                id={`${id}-${String(index)}`} label={row.key} hint={t('form.secretStored')} text={row.value}
                configured stateLabel={t('form.secretStored')} disabled={props.disabled}
                onEdit={(value) => { update(index, { value }) }}
              />
            )
            : (
              <>
                <Input aria-label={t('form.key')} placeholder={t('form.key')} value={row.key} onChange={(event) => { update(index, { key: event.target.value }) }} />
                <Input aria-label={t('form.value')} placeholder={t('form.value')} type="password" autoComplete="new-password" value={row.value} onChange={(event) => { update(index, { value: event.target.value }) }} />
              </>
            )}
          <Button size="sm" variant="ghost" onClick={() => { props.onChange(rows.filter((_row, at) => at !== index)) }}>{t('form.removeEntry')}</Button>
        </div>
      ))}
      <div>
        <Button size="sm" variant="outline" onClick={() => { props.onChange([...rows, { key: '', stored: false, value: '' }]) }}>{t('form.addEntry')}</Button>
      </div>
    </fieldset>
  )
}
