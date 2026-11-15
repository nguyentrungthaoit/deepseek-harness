/** `sidebar` namespace dictionaries for shell controls and global panels. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'panels.label': '全局面板',
  'settings.notifications.title': '桌面通知',
  'settings.notifications.description': '当其他会话需要你操作或已完成时，弹出无声的系统通知。',
  'settings.notifications.denied': '浏览器已屏蔽通知，请在站点设置中允许。',
  'settings.notifications.unsupported': '此浏览器不支持桌面通知。',
  'notify.waiting': '正在等待你的操作',
  'notify.waiting.approval': '正在等待你的批准',
  'notify.waiting.question': '有问题需要你回答',
  'notify.waiting.plan': '计划等待你的审阅',
  'notify.done': '已完成',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'panels.label': 'Global panels',
  'settings.notifications.title': 'Desktop notifications',
  'settings.notifications.description': 'Show a silent system notification when another session needs you or finishes.',
  'settings.notifications.denied': 'The browser blocks notifications for this site; allow them in site settings.',
  'settings.notifications.unsupported': 'This browser does not support desktop notifications.',
  'notify.waiting': 'Waiting for you',
  'notify.waiting.approval': 'Waiting for your approval',
  'notify.waiting.question': 'Has a question for you',
  'notify.waiting.plan': 'Plan ready for your review',
  'notify.done': 'Finished',
} satisfies Record<SidebarKey, string>
