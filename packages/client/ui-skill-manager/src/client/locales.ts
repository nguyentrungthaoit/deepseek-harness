/**
 * `skillManager` namespace dictionaries.
 *
 * The empty-state notice is two sentences: subagents on this project see the
 * same catalog, and only skills with the subagent flag are appended, in full,
 * to each in-process child task.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Rules and skills tab labels, form fields, and row actions. */
    skillManager: SkillManagerKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '规则与技能',
  'guide.title': '规则与技能',
  'guide.description': '管理这个项目的规则和技能',
  loading: '正在读取…',
  empty: '这个项目上的子任务看到同一份目录。只有打开 subagent 的技能会附到进程内子任务，并且每个固定技能都会在每次这类任务里完整加载',
  'group.rules': '规则',
  'group.skills': '技能',
  'source': '来源：{source}',
  'action.create': '新建',
  'action.cancel': '取消',
  'action.save': '保存',
  'action.retry': '重试',
  'action.edit': '编辑 {name}',
  'action.delete': '删除 {name}',
  'action.use': '在对话中使用 {name}',
  'action.editShort': '编辑',
  'action.deleteShort': '删除',
  'action.useShort': '使用',
  'field.name': '名称',
  'field.description': '描述',
  'field.kind': '类型',
  'field.body': '正文',
  'kind.rule': '规则',
  'kind.skill': '技能',
  'toggle.subagent': '{name} 的 subagent',
  'error.name': '名称要用 kebab-case，例如 field-list',
  'error.description': '请填写描述',
  'error.unavailable': '现在还不能保存或删除技能',
  'error.load': '读取失败：{message}',
  'error.save': '保存失败：{message}',
  'error.delete': '删除失败：{message}',
} satisfies Record<string, string>

/** Skill manager dictionary key union. */
export type SkillManagerKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'type.label': 'Rules and skills',
  'guide.title': 'Rules and skills',
  'guide.description': 'Manage rules and skills for this project',
  loading: 'Loading…',
  empty: 'Subagents on this project see the same catalog. Only skills with subagent on are appended to in-process child tasks, and each pinned skill is loaded in full on every such task.',
  'group.rules': 'Rules',
  'group.skills': 'Skills',
  'source': 'Source: {source}',
  'action.create': 'New',
  'action.cancel': 'Cancel',
  'action.save': 'Save',
  'action.retry': 'Retry',
  'action.edit': 'Edit {name}',
  'action.delete': 'Delete {name}',
  'action.use': 'Use {name} in chat',
  'action.editShort': 'Edit',
  'action.deleteShort': 'Delete',
  'action.useShort': 'Use',
  'field.name': 'Name',
  'field.description': 'Description',
  'field.kind': 'Kind',
  'field.body': 'Body',
  'kind.rule': 'Rule',
  'kind.skill': 'Skill',
  'toggle.subagent': 'Subagent for {name}',
  'error.name': 'Use a kebab-case name, such as field-list.',
  'error.description': 'Add a description.',
  'error.unavailable': 'Saving and deleting skills is not available yet.',
  'error.load': 'Could not load skills: {message}',
  'error.save': 'Could not save: {message}',
  'error.delete': 'Could not delete: {message}',
} satisfies Record<SkillManagerKey, string>
