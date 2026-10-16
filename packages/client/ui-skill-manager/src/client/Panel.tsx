/**
 * Rules and skills body: two groups, a create/edit form, and row actions.
 *
 * Writable rows edit, delete, flip subagent, and insert `/name ` into the
 * composer. Read-only rows show their source and can only insert that text.
 * The subagent switch sends the row's current markdown body with the flag flipped.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { groupSkills, isKebabName, SKILL_MUTATIONS_UNAVAILABLE } from './catalog.ts'
import type { CatalogSnapshot, ManagedSkill, SkillDraft } from './catalog.ts'
import type {} from './locales.ts'
import css from './Panel.module.css'

/** Callbacks and the catalog hook this tab injects. */
export interface SkillManagerInjected {
  hooks: {
    /** The session's skill catalog. */
    catalog: SnapshotStore<CatalogSnapshot>
  }
  /**
   * Write one skill file.
   * @param draft - form fields.
   * @returns a failure message, or undefined when the write was accepted.
   */
  write: (draft: SkillDraft) => Promise<string | undefined>
  /**
   * Delete one writable skill.
   * @param name - skill name.
   * @returns a failure message, or undefined when the delete was accepted.
   */
  remove: (name: string) => Promise<string | undefined>
  /**
   * List this session again.
   */
  reload: () => void
  /**
   * Append `/name ` to the session composer.
   * @param name - skill name.
   */
  useInChat: (name: string) => void
}

/** The body's composed props. */
export type SkillManagerBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<SkillManagerInjected>
  & PropsLocale<'skillManager'>

interface EditorTarget {
  readonly skill?: ManagedSkill
}

function noticeFor(
  t: SkillManagerBodyProps['t'],
  key: 'error.save' | 'error.delete',
  message: string | undefined,
): string | undefined {
  if (message === undefined) return undefined
  if (message === SKILL_MUTATIONS_UNAVAILABLE) return t('error.unavailable')
  return t(key, { message })
}

/**
 * The tab body.
 * @param props - the session catalog, its actions, and copy.
 * @returns the list or the open form.
 */
export function SkillManagerBody({
  useCatalog, write, remove, reload, useInChat, t,
}: SkillManagerBodyProps): ReactNode {
  const snapshot = useCatalog(state => state)
  const [editor, setEditor] = useState<EditorTarget | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const groups = groupSkills(snapshot.skills)
  const loading = snapshot.skills.length === 0 && (snapshot.status === 'idle' || snapshot.status === 'loading')

  return (
    <div className={css.root}>
      <div className={css.header}>
        {editor === undefined
          ? <Button size="sm" onClick={() => { setEditor({}); setNotice(undefined) }}>{t('action.create')}</Button>
          : <Button size="sm" onClick={() => { setEditor(undefined) }}>{t('action.cancel')}</Button>}
      </div>
      {editor !== undefined
        ? (
          <Editor
            skill={editor.skill}
            t={t}
            onSubmit={async (draft) => {
              const message = await write(draft)
              if (message === undefined) setEditor(undefined)
              return message
            }}
          />
        )
        : (
          <div className={css.body}>
            {snapshot.status === 'error' && snapshot.message !== undefined && (
              <p className={css.notice} role="alert">{t('error.load', { message: snapshot.message })}</p>
            )}
            {notice !== undefined && <p className={css.notice} role="alert">{notice}</p>}
            {loading && <div className={css.status}><p className={css.statusLine}>{t('loading')}</p></div>}
            {!loading && snapshot.skills.length === 0 && (
              <div className={css.status}>
                <p className={css.statusLine}>{t('empty')}</p>
                {snapshot.status === 'error' && <Button size="sm" onClick={reload}>{t('action.retry')}</Button>}
              </div>
            )}
            {groups.rules.length > 0 && (
              <Group
                label={t('group.rules')}
                skills={groups.rules}
                t={t}
                onEdit={(skill) => { setEditor({ skill }); setNotice(undefined) }}
                onDelete={(skill) => { void runRemove(skill.name) }}
                onSubagent={(skill, next) => { void runWrite(skill, next) }}
                onUse={useInChat}
              />
            )}
            {groups.skills.length > 0 && (
              <Group
                label={t('group.skills')}
                skills={groups.skills}
                t={t}
                onEdit={(skill) => { setEditor({ skill }); setNotice(undefined) }}
                onDelete={(skill) => { void runRemove(skill.name) }}
                onSubagent={(skill, next) => { void runWrite(skill, next) }}
                onUse={useInChat}
              />
            )}
          </div>
        )}
    </div>
  )

  async function runWrite(skill: ManagedSkill, subagent: boolean): Promise<void> {
    const message = await write({
      name: skill.name,
      description: skill.description,
      kind: skill.kind,
      subagent,
      body: skill.body ?? '',
    })
    setNotice(noticeFor(t, 'error.save', message))
  }

  async function runRemove(name: string): Promise<void> {
    const message = await remove(name)
    setNotice(noticeFor(t, 'error.delete', message))
  }
}

function Group({
  label, skills, t, onEdit, onDelete, onSubagent, onUse,
}: {
  label: string
  skills: readonly ManagedSkill[]
  t: SkillManagerBodyProps['t']
  onEdit: (skill: ManagedSkill) => void
  onDelete: (skill: ManagedSkill) => void
  onSubagent: (skill: ManagedSkill, next: boolean) => void
  onUse: (name: string) => void
}): ReactNode {
  return (
    <section>
      <h2 className={css.group}>{label}</h2>
      <ul className={css.list}>
        {skills.map(skill => (
          <li key={skill.name} className={css.row} aria-label={skill.name}>
            <p className={css.name}>{skill.name}</p>
            <p className={css.description}>{skill.description}</p>
            {!skill.writable && <p className={css.source}>{t('source', { source: skill.source })}</p>}
            <div className={css.actions}>
              {skill.writable && (
                <>
                  <Button size="sm" aria-label={t('action.edit', { name: skill.name })} onClick={() => { onEdit(skill) }}>
                    {t('action.editShort')}
                  </Button>
                  <Button size="sm" aria-label={t('action.delete', { name: skill.name })} onClick={() => { onDelete(skill) }}>
                    {t('action.deleteShort')}
                  </Button>
                  <Switch
                    checked={skill.subagent}
                    label={t('toggle.subagent', { name: skill.name })}
                    onChange={(next) => { onSubagent(skill, next) }}
                  />
                </>
              )}
              <Button size="sm" aria-label={t('action.use', { name: skill.name })} onClick={() => { onUse(skill.name) }}>
                {t('action.useShort')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Editor({
  skill, t, onSubmit,
}: {
  skill: ManagedSkill | undefined
  t: SkillManagerBodyProps['t']
  onSubmit: (draft: SkillDraft) => Promise<string | undefined>
}): ReactNode {
  const [name, setName] = useState(skill?.name ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [kind, setKind] = useState<'rule' | 'skill'>(skill?.kind ?? 'skill')
  const [body, setBody] = useState(skill?.body ?? '')
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)

  const save = (): void => {
    const trimmedName = name.trim()
    const trimmedDescription = description.trim()
    if (!isKebabName(trimmedName)) {
      setError(t('error.name'))
      return
    }
    if (trimmedDescription === '') {
      setError(t('error.description'))
      return
    }
    setPending(true)
    setError(undefined)
    const draft: SkillDraft = {
      name: trimmedName,
      description: trimmedDescription,
      kind,
      subagent: skill?.subagent ?? false,
      body,
      ...skill !== undefined && skill.name !== trimmedName ? { replaces: skill.name } : {},
    }
    void onSubmit(draft).then((message) => {
      setPending(false)
      const text = noticeFor(t, 'error.save', message)
      if (text !== undefined) setError(text)
    })
  }

  return (
    <form className={css.form} onSubmit={(event) => { event.preventDefault(); save() }}>
      <label className={css.field}>
        {t('field.name')}
        <Input className={css.input ?? ''} value={name} onChange={(event) => { setName(event.target.value) }} />
      </label>
      <label className={css.field}>
        {t('field.description')}
        <Input className={css.input ?? ''} value={description} onChange={(event) => { setDescription(event.target.value) }} />
      </label>
      <div className={css.field}>
        <span>{t('field.kind')}</span>
        <div className={css.kinds} role="group" aria-label={t('field.kind')}>
          <button type="button" className={css.kind} aria-pressed={kind === 'rule'} onClick={() => { setKind('rule') }}>{t('kind.rule')}</button>
          <button type="button" className={css.kind} aria-pressed={kind === 'skill'} onClick={() => { setKind('skill') }}>{t('kind.skill')}</button>
        </div>
      </div>
      <label className={css.field}>
        {t('field.body')}
        <textarea className={css.textarea} value={body} onChange={(event) => { setBody(event.target.value) }} />
      </label>
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
      <Button variant="primary" size="sm" disabled={pending} onClick={save}>{t('action.save')}</Button>
    </form>
  )
}
