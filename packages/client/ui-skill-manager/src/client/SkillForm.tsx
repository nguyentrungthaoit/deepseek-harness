/**
 * Create and edit form for one flat skill file.
 *
 * Each field keeps one line under it that shows its help and turns into the
 * field's error, so validation never moves the fields below. Content switches
 * between a Write textarea and a Preview that renders the Markdown as the
 * detail page does. A conflict or a vanished skill shows at the top of the
 * form and keeps what the user typed; while the edited skill is not listed,
 * Save creates it. A successful save opens the saved skill's detail page and
 * reports through the toast.
 */
import clsx from 'clsx'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconChevronLeftOutlineRegular, Input, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import { isKebabName } from './catalog.ts'
import type { CatalogSnapshot, ManagedSkill, SkillDraft } from './catalog.ts'
import type { SkillManagerBodyProps } from './Panel.tsx'
import { failureToast } from './SkillToast.tsx'
import { SkillDocument, SubagentRow } from './SkillParts.tsx'
import css from './Panel.module.css'

type FormProps = SkillManagerBodyProps & {
  snapshot: CatalogSnapshot
  /** Name the edit view opened; absent for create. */
  editing?: string
  /** The listed skill named by `editing`, when it still exists. */
  skill?: ManagedSkill | undefined
}

type BodyMode = 'write' | 'preview'

/**
 * One labelled field with its help-or-error line.
 * @param props.id - the control's id; the line is `<id>-hint`.
 * @param props.label - the field label.
 * @param props.hint - help shown while the field is valid.
 * @param props.error - the error shown instead of the help, when set.
 * @param props.accessory - content at the end of the label row.
 * @param props.children - the control.
 * @returns the field.
 */
function Field({ id, label, hint, error, accessory, children }: {
  id: string
  label: string
  hint: string
  error?: string | undefined
  accessory?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <label htmlFor={id} className={css.fieldLabel}>{label}</label>
        {accessory}
      </div>
      {children}
      <span id={`${id}-hint`} className={error === undefined ? css.hint : css.fieldError}>{error ?? hint}</span>
    </div>
  )
}

/**
 * The form page.
 * @param props - the body props, the catalog snapshot, and the edited skill.
 * @returns the breadcrumb and the form.
 */
export function SkillForm({
  snapshot, editing, skill, t, navigate, write, notify,
}: FormProps): ReactNode {
  const [name, setName] = useState(skill?.name ?? editing ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [subagent, setSubagent] = useState(skill?.subagent ?? false)
  const [body, setBody] = useState(skill?.body ?? '')
  const [mode, setMode] = useState<BodyMode>('write')
  const [nameError, setNameError] = useState(false)
  const [descriptionError, setDescriptionError] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [pending, setPending] = useState(false)
  const id = useId()
  const gone = editing !== undefined && skill === undefined && snapshot.status === 'ready' && !pending

  const back = (): void => {
    navigate(editing === undefined || skill === undefined ? { kind: 'list' } : { kind: 'detail', name: editing })
  }

  const save = (): void => {
    const trimmedName = name.trim()
    const trimmedDescription = description.trim()
    const badName = !isKebabName(trimmedName)
    const badDescription = trimmedDescription === ''
    setNameError(badName)
    setDescriptionError(badDescription)
    if (badName || badDescription) return
    setPending(true)
    setConflict(false)
    const draft: SkillDraft = {
      name: trimmedName,
      description: trimmedDescription,
      subagent,
      body,
      ...skill !== undefined && skill.name !== trimmedName ? { replaces: skill.name } : {},
      ...skill?.version === undefined ? {} : { expectedVersion: skill.version },
    }
    void write(draft).then((failure) => {
      setPending(false)
      if (failure === undefined) {
        notify({ kind: 'saved', name: trimmedName })
        navigate({ kind: 'detail', name: trimmedName })
        return
      }
      if (failure.conflict) setConflict(true)
      else notify(failureToast('saveFailed', trimmedName, failure))
    })
  }

  return (
    <>
      <div className={css.header}>
        <button type="button" className={css.crumb} onClick={back}>
          <IconChevronLeftOutlineRegular size={14} />
          {editing ?? t('type.label')}
        </button>
      </div>
      <form className={`${css.body} ${css.form}`} onSubmit={(event) => { event.preventDefault(); save() }}>
        {(conflict || gone) && (
          <p className={css.formNotice} role="alert">{t(conflict ? 'form.conflict' : 'form.gone')}</p>
        )}
        <div className={css.formCard}>
          <Field
            id={`${id}-name`}
            label={t('field.name')}
            hint={t('field.nameHelp')}
            error={nameError ? t('error.name') : undefined}
          >
            <Input
              id={`${id}-name`}
              className={clsx(css.input)}
              value={name}
              aria-invalid={nameError}
              aria-describedby={`${id}-name-hint`}
              onChange={(event) => { setName(event.target.value) }}
            />
          </Field>
          <Field
            id={`${id}-description`}
            label={t('section.description')}
            hint={t('field.descriptionHelp')}
            error={descriptionError ? t('error.description') : undefined}
          >
            <Input
              id={`${id}-description`}
              className={clsx(css.input)}
              value={description}
              aria-invalid={descriptionError}
              aria-describedby={`${id}-description-hint`}
              onChange={(event) => { setDescription(event.target.value) }}
            />
          </Field>
          <SubagentRow label={t('section.subagent')} checked={subagent} onChange={setSubagent} t={t} />
          <Field
            id={`${id}-body`}
            label={t('section.body')}
            hint={t('field.bodyHelp')}
            accessory={(
              <SegmentedControl<BodyMode>
                id={`${id}-mode`}
                className={css.modeSwitch}
                label={t('body.mode')}
                value={mode}
                onChange={setMode}
                options={[{ value: 'write', label: t('body.write') }, { value: 'preview', label: t('body.preview') }]}
              />
            )}
          >
            <div id={`${id}-mode-write-panel`} role="tabpanel" aria-labelledby={`${id}-mode-write`} hidden={mode !== 'write'}>
              <textarea
                id={`${id}-body`}
                className={css.textarea}
                value={body}
                spellCheck={false}
                aria-describedby={`${id}-body-hint`}
                onChange={(event) => { setBody(event.target.value) }}
              />
            </div>
            <div
              id={`${id}-mode-preview-panel`}
              role="tabpanel"
              aria-labelledby={`${id}-mode-preview`}
              className={css.preview}
              hidden={mode !== 'preview'}
            >
              {mode === 'preview' && <SkillDocument text={body} t={t} />}
            </div>
          </Field>
        </div>
        <div className={css.formActions}>
          <Button variant="outline" size="sm" onClick={back}>{t('action.cancel')}</Button>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>{t('action.save')}</Button>
        </div>
      </form>
    </>
  )
}
