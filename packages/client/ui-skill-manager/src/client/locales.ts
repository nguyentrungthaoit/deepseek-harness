/**
 * `skillManager` namespace dictionaries.
 *
 * `header.info` and `subagent.help` state what the panel's two controls do:
 * a skill loads on `/name` or a model call, and the Subagent switch appends
 * the skill in full to every in-process subagent task.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skills tab labels, form fields, card actions, and toasts. */
    skillManager: SkillManagerKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '技能',
  'guide.title': '技能',
  'guide.description': '管理这个项目的技能',
  'header.about': '关于技能',
  'header.info': '输入 /名称 或模型调用时会加载技能。打开 Subagent 后，进程内子任务也会附带它',
  loading: '正在读取技能',
  'action.refresh': '刷新',
  'action.create': '新建技能',
  'group.editable': '可编辑',
  'group.readonly': '只读',
  'action.insert': '把 /{name} 插入对话',
  'action.use': '在对话中使用',
  'action.edit': '编辑',
  'action.delete': '删除',
  'action.save': '保存',
  'action.cancel': '取消',
  'action.close': '关闭',
  'action.retry': '重试',
  empty: '这个项目还没有技能',
  'field.name': '名称',
  'section.description': '描述',
  'section.body': '内容',
  'section.source': '来源',
  'section.subagent': 'Subagent',
  'toggle.subagent': '{name} 的 Subagent',
  'body.unreadable': '无法读取这个技能的内容',
  'subagent.help': '每个进程内子任务都会完整加载。Codex、Claude Code 和 ACP 子任务不会附带',
  'confirm.title': '删除 {name}？',
  'confirm.description': '会从项目中删除 .agents/skills/{name}.md',
  'confirm.action': '删除',
  'toast.saved': '已保存 {name}',
  'toast.deleted': '已删除 {name}',
  'toast.subagentOn': '已为 {name} 打开 Subagent',
  'toast.subagentOff': '已为 {name} 关闭 Subagent',
  'toast.saveFailed': '无法保存 {name}。{message}',
  'toast.deleteFailed': '无法删除 {name}。{message}',
  conflict: '{name} 已在磁盘上更改，请刷新查看最新版本',
  'form.conflict': '文件已在磁盘上更改。刷新可查看，你的修改会保留',
  'form.gone': '这个技能已被删除或改名。保存会重新创建',
  'error.load': '无法读取技能',
  'error.name': '名称要用 kebab-case，例如 field-list',
  'error.description': '请填写描述',
  'search.placeholder': '搜索技能',
  'search.empty': '没有匹配的技能',
  'badge.subagent': 'Subagent',
  'chip.subagentOn': 'Subagent 已打开',
  'chip.subagentOff': 'Subagent 已关闭',
  'field.nameHelp': '用连字符连接的小写单词，在对话中输入 /名称 调用',
  'field.descriptionHelp': '模型根据这段描述决定何时调用技能',
  'field.bodyHelp': '技能加载时模型读取的 Markdown',
  'body.mode': '内容视图',
  'body.write': '编辑',
  'body.preview': '预览',
  'body.empty': '这个技能还没有内容',
} satisfies Record<string, string>

/** Skill manager dictionary key union. */
export type SkillManagerKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'type.label': 'Skills',
  'guide.title': 'Skills',
  'guide.description': "Manage this project's skills",
  'header.about': 'About skills',
  'header.info': 'A skill loads when you type /name or when the model calls it. Turn on Subagent to also attach it to subagent tasks in this process.',
  loading: 'Loading skills',
  'action.refresh': 'Refresh',
  'action.create': 'New skill',
  'group.editable': 'Editable',
  'group.readonly': 'Read-only',
  'action.insert': 'Insert /{name} into chat',
  'action.use': 'Use in chat',
  'action.edit': 'Edit',
  'action.delete': 'Delete',
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.close': 'Close',
  'action.retry': 'Retry',
  empty: 'This project has no skills yet.',
  'field.name': 'Name',
  'section.description': 'Description',
  'section.body': 'Content',
  'section.source': 'Source',
  'section.subagent': 'Subagent',
  'toggle.subagent': 'Subagent for {name}',
  'body.unreadable': "Couldn't read this skill's content.",
  'subagent.help': "Loaded in full on every subagent task in this process. Codex, Claude Code, and ACP subagents don't get it.",
  'confirm.title': 'Delete {name}?',
  'confirm.description': 'This deletes .agents/skills/{name}.md from the project.',
  'confirm.action': 'Delete',
  'toast.saved': 'Saved {name}',
  'toast.deleted': 'Deleted {name}',
  'toast.subagentOn': 'Subagent on for {name}',
  'toast.subagentOff': 'Subagent off for {name}',
  'toast.saveFailed': "Couldn't save {name}. {message}",
  'toast.deleteFailed': "Couldn't delete {name}. {message}",
  conflict: '{name} changed on disk. Reload to see the latest version.',
  'form.conflict': 'This file changed on disk. Reload to see it; your edits are kept.',
  'form.gone': 'This skill was deleted or renamed. Saving creates it again.',
  'error.load': "Couldn't load skills.",
  'error.name': 'Use a kebab-case name, such as field-list.',
  'error.description': 'Add a description.',
  'search.placeholder': 'Search skills',
  'search.empty': 'No skills match your search.',
  'badge.subagent': 'Subagent',
  'chip.subagentOn': 'Subagent on',
  'chip.subagentOff': 'Subagent off',
  'field.nameHelp': 'Lowercase words joined by hyphens. Type /name in chat to use it.',
  'field.descriptionHelp': 'The model reads this to decide when to call the skill.',
  'field.bodyHelp': 'Markdown the model reads when the skill loads.',
  'body.mode': 'Content view',
  'body.write': 'Write',
  'body.preview': 'Preview',
  'body.empty': 'This skill has no content yet.',
} satisfies Record<SkillManagerKey, string>
