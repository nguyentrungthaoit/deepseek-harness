/**
 * Create and edit form for one MCP server row. Stored values the user does not
 * touch are kept, a `!!js` field shows its source until replaced, and secrets
 * are write-only. Save is enabled once the form names a valid server and the
 * field its transport requires.
 */
import clsx from 'clsx'
import { useId, useState, type ReactNode } from 'react'
import {
  Button, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, Input, SegmentedControl, Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpServerDraft, McpServerView, McpTransport } from '@deepseek-ai/dsh-mcp-manager/types'
import { edit, initialForm, problem, toDraft, type Field, type FormState } from './form-model.ts'
import { KeyValueEditor } from './KeyValueEditor.tsx'
import type { McpManagerLocaleKey } from './locales.ts'
import css from './McpPanel.module.css'
import { ServerAvatar } from './ServerList.tsx'

/**
 * One text field that may hold a stored expression.
 * @returns the labelled input, or the expression with a replace control.
 */
function TextField(props: {
  label: string
  field: Field<string>
  multiline?: boolean
  mono?: boolean
  onChange: (next: Field<string>) => void
  t: TranslateNS<'mcpManager'>
}): ReactNode {
  const id = useId()
  const { field, t } = props
  const change = (value: string): void => { props.onChange(edit(field, value)) }
  const mono = clsx(props.mono === true && css.mono)
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={id}>{props.label}</label>
      {field.expression !== undefined && !field.dirty
        ? (
          <div className={css.expression}>
            <code id={id} className={css.code}>{t('form.expression', { source: field.expression })}</code>
            <Button size="sm" variant="outline" onClick={() => { props.onChange(edit(field, '')) }}>{t('form.replaceExpression')}</Button>
          </div>
        )
        : props.multiline === true
          ? (
            <textarea
              id={id} className={clsx(css.textarea, mono)} rows={3} value={field.value}
              onChange={(event) => { change(event.target.value) }}
            />
          )
          : <Input id={id} className={mono} value={field.value} onChange={(event) => { change(event.target.value) }} />}
    </div>
  )
}

/**
 * @param props.view - the row being edited; absent when creating.
 * @param props.saving - the save is in flight.
 * @param props.error - the last save failure, as a locale key.
 * @param props.onSubmit - receives the draft to save.
 * @param props.onCancel - leaves the form.
 * @param props.t - panel copy.
 * @returns the form.
 */
export function ServerForm(props: {
  view?: McpServerView | undefined
  saving: boolean
  error?: McpManagerLocaleKey | undefined
  onSubmit: (draft: McpServerDraft) => void
  onCancel: () => void
  t: TranslateNS<'mcpManager'>
}): ReactNode {
  const { t } = props
  const id = useId()
  const [state, setState] = useState<FormState>(() => initialForm(props.view))
  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => { setState(current => ({ ...current, [key]: value })) }
  const blocked = problem(state)
  const stdio = state.transport === 'stdio'
  return (
    <form className={css.detail} onSubmit={(event) => {
      event.preventDefault()
      if (blocked === undefined) props.onSubmit(toDraft(state))
    }}>
      <div>
        <button type="button" className={css.crumb} onClick={props.onCancel}>
          <IconChevronLeftOutlineRegular size={14} />
          {t('action.back')}
        </button>
      </div>
      <div className={css.formHead}>
        <ServerAvatar name={state.serverName.trim() === '' ? '+' : state.serverName} size="lg" />
        <h2 className={css.heroName}>{t(props.view === undefined ? 'form.createTitle' : 'form.editTitle')}</h2>
      </div>
      {props.error === undefined ? null : <p role="alert" className={`${css.notice} ${css.noticeDanger}`}>{t(props.error)}</p>}
      <fieldset className={css.fields} disabled={props.saving}>
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('form.section.server')}</h3>
          <div className={`${css.card} ${css.formCard}`}>
            <div className={css.field}>
              <label className={css.label} htmlFor={`${id}-name`}>{t('form.serverName')}</label>
              <Input id={`${id}-name`} value={state.serverName} aria-describedby={`${id}-name-hint`} onChange={(event) => { set('serverName', event.target.value) }} />
              <p id={`${id}-name-hint`} className={css.hint}>{t('form.serverNameHint')}</p>
            </div>
            <div className={css.field}>
              <span className={css.label} aria-hidden>{t('form.transport')}</span>
              <SegmentedControl<McpTransport>
                id={`${id}-transport`} label={t('form.transport')} value={state.transport} className={css.transport}
                options={[{ value: 'stdio', label: t('transport.stdio') }, { value: 'streamable-http', label: t('transport.http') }]}
                onChange={(next) => { setState(current => ({ ...current, transport: next, secrets: [] })) }}
              />
            </div>
          </div>
        </section>
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('form.section.connection')}</h3>
          <div className={`${css.card} ${css.formCard}`}>
            {stdio
              ? (
                <>
                  <TextField label={t('form.command')} field={state.command} mono t={t} onChange={(next) => { set('command', next) }} />
                  <TextField label={t('form.args')} field={state.args} multiline mono t={t} onChange={(next) => { set('args', next) }} />
                  <TextField label={t('form.cwd')} field={state.cwd} mono t={t} onChange={(next) => { set('cwd', next) }} />
                </>
              )
              : <TextField label={t('form.url')} field={state.url} mono t={t} onChange={(next) => { set('url', next) }} />}
          </div>
        </section>
        <KeyValueEditor
          label={t(stdio ? 'form.env' : 'form.headers')} rows={state.secrets} disabled={props.saving} t={t}
          onChange={(rows) => { set('secrets', rows) }}
        />
        <details className={`${css.card} ${css.advanced}`}>
          <summary>
            <IconChevronRightOutlineRegular size={14} className={css.advancedChevron} />
            {t('form.advanced')}
          </summary>
          <div className={css.advancedBody}>
            <TextField label={t('form.toolCallTimeoutMs')} field={state.toolCallTimeoutMs} t={t} onChange={(next) => { set('toolCallTimeoutMs', next) }} />
            <div className={css.switchRow}>
              <span aria-hidden>{t('form.failOnStartupError')}</span>
              <Switch label={t('form.failOnStartupError')} checked={state.failOnStartupError.value} onChange={(next) => { set('failOnStartupError', edit(state.failOnStartupError, next)) }} />
            </div>
            <div className={css.switchRow}>
              <span aria-hidden>{t('form.reconnectEnabled')}</span>
              <Switch label={t('form.reconnectEnabled')} checked={state.reconnectEnabled.value} onChange={(next) => { set('reconnectEnabled', edit(state.reconnectEnabled, next)) }} />
            </div>
          </div>
        </details>
      </fieldset>
      <div className={css.formFooter}>
        <Button variant="ghost" onClick={props.onCancel}>{t('action.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={props.saving || blocked !== undefined}>{t('action.save')}</Button>
      </div>
    </form>
  )
}
