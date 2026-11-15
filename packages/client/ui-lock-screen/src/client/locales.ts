/** `lockScreen` namespace dictionaries for the lock button, overlay, and Settings row. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Lock screen button, overlay prompts, agent status lines, and Settings row. */
    lockScreen: LockScreenLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'lockScreen'

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  button: '锁屏',
  'shortcut.lock': '锁定屏幕',
  'dialog.label': '锁屏',
  'tab.agent': 'AGENT',
  'status.idle': '所有 Agent 都已空闲',
  'status.running': '运行中：{title}',
  'status.runningMore': '运行中：{title}（另有 {count} 个）',
  'status.waiting': '等待你的批准：{title}',
  'status.done': '任务完成：{title}',
  summary: '{running} 个运行中 · {waiting} 个等待批准 · {done} 个已完成',
  pressStart: '按任意键',
  'prompt.unlock': '输入密码',
  'prompt.setup': '为锁屏设置密码',
  'prompt.confirm': '再次输入同一密码',
  'prompt.change': '输入新的锁屏密码',
  'hint.unlock': 'Enter 解锁 · Esc 返回 · F 全屏',
  'hint.setup': 'Enter 继续 · Esc 取消',
  'input.label': '密码',
  checking: '正在检查…',
  'error.empty': '请至少输入一个字符',
  'error.mismatch': '两次输入的密码不一致，请重新设置',
  'error.wrong.1': 'Exception in thread "main" java.lang.SecurityException: Access denied',
  'error.wrong.2': '    at dev.devz.LockScreen.unlock(LockScreen.java:42)',
  'error.wrong.3': 'Caused by: TypoException: 密码错误（第 {count} 次）',
  'ok.title': 'BUILD SUCCESS',
  'ok.detail': 'Total time: 0.042 s · 欢迎回来',
  'settings.title': '锁屏',
  'settings.set': '已设置密码。可在侧栏或用快捷键锁屏，也可在此修改密码。锁屏只在此浏览器中遮住页面，不会退出登录。',
  'settings.unset': '尚未设置密码；可在此设置，或在第一次锁屏时设置。锁屏只在此浏览器中遮住页面，不会退出登录。',
  'settings.lockNow': '立即锁屏',
  'settings.setPassword': '设置密码',
  'settings.change': '修改密码',
  'settings.remove': '移除密码',
  'settings.theme': '锁屏样式',
  'theme.pixel': '像素房间',
  'theme.matrix': 'Matrix',
  'matrix.bar': 'dsh://operator — 已锁定',
  'matrix.wake': '醒醒，操作员……Agent 还在工作。',
  'matrix.hint': 'Enter 解锁 · Esc 清空',
  'matrix.denied.1': 'ACCESS DENIED',
  'matrix.denied.2': '认证失败（第 {count} 次）。系统正在监视。',
  'matrix.ok.title': 'ACCESS GRANTED',
  'matrix.ok.detail': '欢迎回到真实世界',
} as const

/** Key union derived from the Chinese dictionary. */
export type LockScreenLocaleKey = keyof typeof zh

/** English dictionary. */
export const en = {
  button: 'Lock',
  'shortcut.lock': 'Lock screen',
  'dialog.label': 'Lock screen',
  'tab.agent': 'AGENT',
  'status.idle': 'All agents are idle',
  'status.running': 'Running: {title}',
  'status.runningMore': 'Running: {title} (+{count} more)',
  'status.waiting': 'Waiting for your approval: {title}',
  'status.done': 'Quest clear: {title}',
  summary: '{running} running · {waiting} waiting · {done} done',
  pressStart: 'Press any key',
  'prompt.unlock': 'Enter password',
  'prompt.setup': 'Set a password for the lock screen',
  'prompt.confirm': 'Enter the same password again',
  'prompt.change': 'Enter a new lock screen password',
  'hint.unlock': 'Enter to unlock · Esc to go back · F for full screen',
  'hint.setup': 'Enter to continue · Esc to cancel',
  'input.label': 'Password',
  checking: 'Checking…',
  'error.empty': 'Enter at least one character',
  'error.mismatch': 'The passwords do not match. Start again.',
  'error.wrong.1': 'Exception in thread "main" java.lang.SecurityException: Access denied',
  'error.wrong.2': '    at dev.devz.LockScreen.unlock(LockScreen.java:42)',
  'error.wrong.3': 'Caused by: TypoException: wrong password (attempt {count})',
  'ok.title': 'BUILD SUCCESS',
  'ok.detail': 'Total time: 0.042 s · Welcome back',
  'settings.title': 'Lock screen',
  'settings.set': 'A password is set. Lock from the sidebar or with the shortcut, or change the password here. The lock covers the page in this browser only; it does not sign you out.',
  'settings.unset': 'No password yet; set one here, or the first lock asks for one. The lock covers the page in this browser only; it does not sign you out.',
  'settings.lockNow': 'Lock now',
  'settings.setPassword': 'Set password',
  'settings.change': 'Change password',
  'settings.remove': 'Remove password',
  'settings.theme': 'Lock screen style',
  'theme.pixel': 'Pixel room',
  'theme.matrix': 'Matrix',
  'matrix.bar': 'dsh://operator — locked',
  'matrix.wake': 'Wake up, operator… the agents are still working.',
  'matrix.hint': 'Enter to unlock · Esc to clear',
  'matrix.denied.1': 'ACCESS DENIED',
  'matrix.denied.2': 'Authentication failed (attempt {count}). The system is watching.',
  'matrix.ok.title': 'ACCESS GRANTED',
  'matrix.ok.detail': 'Welcome back to the real world',
} satisfies Record<LockScreenLocaleKey, string>
