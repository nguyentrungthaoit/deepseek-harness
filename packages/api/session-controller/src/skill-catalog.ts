/** Session-addressed, cold-readable skill catalog Remote. */

import { access, lstat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { isSkillName, isUserInvocable } from '@deepseek-ai/dsh-skill'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SkillDeleteRequest,
  SkillEntry,
  SkillFileValue,
  SkillListRequest,
  SkillListValue,
  SkillWriteRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the Session-addressed `skills` Remote namespace. */
    sessionSkillCatalog: SessionSkillCatalog
  }
}

interface OpenedSkillCatalog {
  readonly cwd: string
  readonly scope: ScopeKey | undefined
  readonly registry: {
    list(options: { readonly cwd: string; readonly scope: ScopeKey | undefined }): Promise<readonly SkillSummary[]>
    get?(
      name: string,
      options: { readonly cwd: string; readonly scope: ScopeKey | undefined },
    ): Promise<{ readonly content?: string } | undefined>
  }
  readonly [Symbol.asyncDispose]: () => Promise<void>
}

/** Host service backing `ctx.remote.skills` without activating a cold Agent. */
export class SessionSkillCatalog extends TypertRemoteService {
  static inject = ['agents', 'sessionQuery', 'typert']

  /** @param ctx - Host context carrying Session reads and optional skill/preset services. */
  constructor(ctx: Context) {
    super(ctx, 'sessionSkillCatalog', { namespace: 'skills' })
  }

  /**
   * List the user-invocable skills visible to one Session composition.
   * @param request - Session identity whose cwd and preset select the catalog view.
   * @param signal - caller lifetime carried by the Remote transport; admitted catalog reads retain their existing completion semantics.
   * @returns user-invocable skill metadata. Writable rows also include the markdown body when it can be read.
   * @throws RemoteError when the Session cannot be inspected or no registry can serve it.
   */
  @Remote
  async list(request: SkillListRequest, signal: AbortSignal): Promise<SkillListValue> {
    void signal
    await using opened = await this.openCatalog(request.sessionId)
    const projectRoot = await findProjectRoot(opened.cwd, this.ctx.get('fs'))
    try {
      const skills = (await opened.registry.list({ cwd: opened.cwd, scope: opened.scope })).filter(isUserInvocable)
      const entries: SkillEntry[] = []
      for (const skill of skills) {
        const entry = skillEntry(skill, projectRoot, opened.cwd)
        const body = entry.writable
          ? await writableSkillBody(opened.registry, skill.name, opened.cwd, opened.scope)
          : undefined
        entries.push(body === undefined ? entry : { ...entry, body })
      }
      return { skills: entries }
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `skill listing failed: ${String(error)}`, {})
    }
  }

  /**
   * Create or replace one flat project skill file inside the Session workspace.
   * @param request - file name, frontmatter fields, markdown body, and optional previous name.
   * @param signal - caller lifetime; aborts before a filesystem mutation when already cancelled.
   * @returns the flat file path that was written.
   * @throws RemoteError when the name, path, owning skill, or filesystem rejects the write.
   */
  @Remote
  async write(request: SkillWriteRequest, signal: AbortSignal): Promise<SkillFileValue> {
    signal.throwIfAborted()
    const kind = skillKindOf(request.kind)
    const description = requiredString(request.description, 'description')
    const body = requiredString(request.body, 'body')
    if (typeof request.subagent !== 'boolean') {
      throw new RemoteError('gateway/bad-request', 'skill subagent must be a boolean', {})
    }
    await using opened = await this.openCatalog(request.sessionId)
    const fs = this.filesystem()
    const projectRoot = await findProjectRoot(opened.cwd, fs)
    const file = flatSkillFile(projectRoot, opened.cwd, request.name)
    const skills = await this.listedSkills(opened)
    const replaces = request.replaces
    if (replaces !== undefined) {
      assertSkillName(replaces)
      const previous = flatSkillFile(projectRoot, opened.cwd, replaces)
      assertReplaceAvailable(skills, request.name)
      assertWritableWinner(skills, replaces, previous, opened.cwd)
      if (await skillPathInfo(fs, file, signal) !== undefined) {
        throw new RemoteError('gateway/bad-request', `skill "${request.name}" already exists at "${file}"`, {})
      }
    } else {
      assertNameFree(skills, request.name, file)
      const existing = await skillPathInfo(fs, file, signal)
      if (existing !== undefined && existing.type !== 'file') {
        throw new RemoteError('gateway/bad-request', `skill path "${file}" is not a regular file`, {})
      }
    }
    const content = skillDocument({
      name: request.name,
      description,
      kind,
      subagent: request.subagent,
      body,
    })
    await writeSkillFile(fs, file, opened.cwd, content, signal)
    if (replaces !== undefined) {
      const previous = flatSkillFile(projectRoot, opened.cwd, replaces)
      try {
        await deleteHostSkillFile(fs, previous, opened.cwd, signal)
      } catch (error: unknown) {
        observeSkillMutation(opened.registry)
        throw new RemoteError(
          'gateway/internal',
          `skill "${request.name}" was written, but the old file is still present at "${previous}"`,
          {},
          error instanceof Error ? { cause: error } : undefined,
        )
      }
    }
    observeSkillMutation(opened.registry)
    return { path: file }
  }

  /**
   * Delete the winning flat project skill file inside the Session workspace.
   * @param request - Session identity and kebab-case skill name.
   * @param signal - caller lifetime; aborts before deletion when already cancelled.
   * @returns the flat file path that was deleted.
   * @throws RemoteError when the name is not a writable flat file, or the host cannot unlink it.
   */
  @Remote
  async delete(request: SkillDeleteRequest, signal: AbortSignal): Promise<SkillFileValue> {
    signal.throwIfAborted()
    await using opened = await this.openCatalog(request.sessionId)
    const fs = this.filesystem()
    const projectRoot = await findProjectRoot(opened.cwd, fs)
    const file = flatSkillFile(projectRoot, opened.cwd, request.name)
    const skills = await this.listedSkills(opened)
    assertWritableWinner(skills, request.name, file, opened.cwd)
    await deleteHostSkillFile(fs, file, opened.cwd, signal)
    observeSkillMutation(opened.registry)
    return { path: file }
  }

  /** Resolve a live or standing preset scope without creating an Agent. */
  private async scopeFor(
    agentPreset: string | undefined,
  ): Promise<({ key: ScopeKey } & AsyncDisposable) | undefined> {
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return undefined
    try {
      return await presets.acquireScope(agentPreset)
    } catch {
      // An unknown or unusable recorded preset falls back to the global registry.
      return undefined
    }
  }

  /** Read the Session cwd and the registry that serves its catalog. */
  private async openCatalog(sessionId: SkillListRequest['sessionId']): Promise<OpenedSkillCatalog> {
    let cwd: string | undefined
    let agentPreset: string | undefined
    try {
      using observation = await this.ctx.sessionQuery.observeSession(sessionId)
      if (observation.projections === undefined) {
        throw new Error('skill catalog requires a projected Session observation')
      }
      cwd = observation.header.cwd
      agentPreset = observation.projections.values.agentPreset ?? undefined
    } catch (error: unknown) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `session "${sessionId}" could not be inspected: ${String(error)}`,
        {},
      )
    }
    if (cwd === undefined) {
      throw new RemoteError('gateway/internal', `session "${sessionId}" has no project cwd`, {})
    }

    const live = this.ctx.agents.get(sessionId)
    const presets = this.ctx.get('agentPresets')
    const scoped = live === undefined ? undefined : presets?.serviceFor(live, 'skills')
    const registry = scoped ?? this.ctx.get('skills')
    if (registry === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'skill registry is absent: neither this session\'s agent preset nor the host composition mounts @deepseek-ai/dsh-skill',
        {},
      )
    }
    const lease = live === undefined ? await this.scopeFor(agentPreset) : undefined
    return {
      cwd,
      scope: live ?? lease?.key,
      registry,
      async [Symbol.asyncDispose]() {
        await lease?.[Symbol.asyncDispose]()
      },
    }
  }

  /** List winning skills, preserving an already classified Remote failure. */
  private async listedSkills(opened: OpenedSkillCatalog): Promise<readonly SkillSummary[]> {
    try {
      return await opened.registry.list({ cwd: opened.cwd, scope: opened.scope })
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', `skill listing failed: ${String(error)}`, {})
    }
  }

  /** Require the filesystem service that writes and resolves skill files. */
  private filesystem(): FileSystem {
    const fs = this.ctx.get('fs')
    if (fs === undefined) {
      throw new RemoteError('gateway/internal', 'filesystem is absent', {})
    }
    return fs
  }
}

export default SessionSkillCatalog

function skillKind(skill: { readonly name: string; readonly kind?: 'rule' | 'skill' }): 'rule' | 'skill' {
  return skill.kind === 'rule' ? 'rule' : 'skill'
}

function skillSubagent(skill: { readonly name: string; readonly subagent?: boolean }): boolean {
  return skill.subagent === true
}

function skillEntry(skill: SkillSummary, projectRoot: string, workspaceRoot: string): SkillEntry {
  const file = join(projectRoot, '.agents', 'skills', `${skill.name}.md`)
  return {
    name: skill.name,
    ...skill.path === undefined ? {} : { path: skill.path },
    description: skill.description,
    ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
    modelInvocable: skill.invocation.modelInvocable,
    kind: skillKind(skill),
    subagent: skillSubagent(skill),
    source: skill.source,
    writable: skill.path !== undefined && samePath(skill.path, file) && isInsidePath(workspaceRoot, skill.path),
  }
}

function skillKindOf(kind: string): 'rule' | 'skill' {
  if (kind === 'rule' || kind === 'skill') return kind
  throw new RemoteError('gateway/bad-request', 'skill kind must be "rule" or "skill"', {})
}

function requiredString(value: string, field: string): string {
  if (typeof value !== 'string') {
    throw new RemoteError('gateway/bad-request', `skill ${field} must be a string`, {})
  }
  return value
}

function assertSkillName(name: string): void {
  if (!isSkillName(name)) {
    throw new RemoteError('gateway/bad-request', `skill name "${name}" must be kebab-case`, {})
  }
}

/** Flat `<projectRoot>/.agents/skills/<name>.md` path that stays inside the workspace. */
function flatSkillFile(projectRoot: string, workspaceRoot: string, name: string): string {
  assertSkillName(name)
  const directory = join(projectRoot, '.agents', 'skills')
  const file = join(directory, `${name}.md`)
  if (relative(directory, file) !== `${name}.md`) {
    throw new RemoteError('gateway/bad-request', `skill "${name}" must stay inside ${directory}`, {})
  }
  if (!isInsidePath(workspaceRoot, file)) {
    throw new RemoteError(
      'gateway/bad-request',
      `skill "${name}" path "${file}" is outside the session workspace`,
      {},
    )
  }
  return file
}

function assertNameFree(skills: readonly SkillSummary[], name: string, file: string): void {
  const winner = skills.find(skill => skill.name === name)
  if (winner === undefined) return
  if (winner.path !== undefined && samePath(winner.path, file)) return
  throw new RemoteError('gateway/bad-request', ownedSkillMessage(name, winner.path), {})
}

function assertReplaceAvailable(skills: readonly SkillSummary[], name: string): void {
  const winner = skills.find(skill => skill.name === name)
  if (winner === undefined) return
  throw new RemoteError('gateway/bad-request', ownedSkillMessage(name, winner.path), {})
}

function assertWritableWinner(
  skills: readonly SkillSummary[],
  name: string,
  file: string,
  workspaceRoot: string,
): void {
  const winner = skills.find(skill => skill.name === name)
  if (winner?.path !== undefined && samePath(winner.path, file) && isInsidePath(workspaceRoot, winner.path)) return
  const where = winner?.path === undefined ? '' : ` at "${winner.path}"`
  throw new RemoteError(
    'gateway/bad-request',
    `skill "${name}" is not a writable flat project skill${where}`,
    {},
  )
}

function ownedSkillMessage(name: string, path: string | undefined): string {
  return `skill "${name}" is owned by ${path ?? 'a skill with no file path'}`
}

function skillDocument(skill: {
  readonly name: string
  readonly description: string
  readonly kind: 'rule' | 'skill'
  readonly subagent: boolean
  readonly body: string
}): string {
  return [
    '---',
    `name: ${skill.name}`,
    `description: ${yamlScalar(skill.description)}`,
    'metadata:',
    `  kind: ${skill.kind}`,
    `  subagent: ${skill.subagent ? 'true' : 'false'}`,
    '---',
    skill.body,
  ].join('\n')
}

function yamlScalar(value: string): string {
  if (value.length > 0
    && !/[\n\r:#{}[\],&*!|>'"%@`]|^\s|\s$/.test(value)
    && !/^(?:true|false|null|yes|no|on|off|~)$/i.test(value)
    && !/^-?\d/.test(value)) {
    return value
  }
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')}"`
}

async function skillPathInfo(fs: FileSystem, file: string, signal: AbortSignal) {
  try {
    return await fs.lstat(file, undefined, signal)
  } catch (error: unknown) {
    if (signal.aborted) throw new RemoteError('gateway/cancelled', 'skill write was aborted', {})
    throw new RemoteError('gateway/internal', `skill path could not be inspected: ${String(error)}`, {})
  }
}

async function writeSkillFile(
  fs: FileSystem,
  file: string,
  workspaceRoot: string,
  content: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    const target = await fs.resolve(file, { signal })
    assertResolvedSkillPath(file, workspaceRoot, fs.processPath(target))
    await fs.writeText(target, content, undefined, signal)
  } catch (error: unknown) {
    if (error instanceof RemoteError) throw error
    if (signal.aborted) throw new RemoteError('gateway/cancelled', 'skill write was aborted', {})
    throw new RemoteError('gateway/internal', `skill write failed: ${String(error)}`, {})
  }
}

async function deleteHostSkillFile(
  fs: FileSystem,
  file: string,
  workspaceRoot: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  let hostPath: string
  try {
    const target = await fs.resolve(file, { signal })
    const executionPath = fs.processPath(target)
    assertResolvedSkillPath(file, workspaceRoot, executionPath)
    const mapped = fs.processPathFromHostPath(executionPath)
    if (mapped === undefined || resolve(mapped) !== resolve(executionPath)) {
      throw new RemoteError('gateway/internal', 'skill delete is unavailable', {})
    }
    hostPath = executionPath
  } catch (error: unknown) {
    if (error instanceof RemoteError) throw error
    if (signal.aborted) throw new RemoteError('gateway/cancelled', 'skill delete was aborted', {})
    throw new RemoteError('gateway/internal', `skill delete is unavailable: ${String(error)}`, {})
  }
  let info
  try {
    info = await lstat(hostPath)
  } catch (error: unknown) {
    throw new RemoteError('gateway/internal', `skill file could not be deleted: ${String(error)}`, {})
  }
  if (!info.isFile()) {
    throw new RemoteError('gateway/bad-request', `skill path "${hostPath}" is not a regular file`, {})
  }
  try {
    await unlink(hostPath)
  } catch (error: unknown) {
    throw new RemoteError('gateway/internal', `skill file could not be deleted: ${String(error)}`, {})
  }
}

/**
 * Invalidate a skill registry after a mutation when it exposes that method.
 * The call keeps the registry as `this` so `SkillRegistry.invalidate` can clear its cache.
 * @param registry - the registry that served this Session.
 */
function observeSkillMutation(registry: object): void {
  const invalidate = 'invalidate' in registry ? registry.invalidate : undefined
  if (typeof invalidate !== 'function') return
  invalidate.call(registry)
}

/**
 * Markdown body of one writable skill, or `undefined` when this registry cannot load it.
 * @param registry - the registry that served this Session.
 * @param name - kebab-case skill name.
 * @param cwd - Session workspace directory.
 * @param scope - viewing scope, when the Session has one.
 * @returns the body after frontmatter, or `undefined` when it is absent or unreadable.
 */
async function writableSkillBody(
  registry: OpenedSkillCatalog['registry'],
  name: string,
  cwd: string,
  scope: ScopeKey | undefined,
): Promise<string | undefined> {
  if (registry.get === undefined) return undefined
  let loaded: { readonly content?: string } | undefined
  try {
    loaded = await registry.get(name, { cwd, scope })
  } catch (error: unknown) {
    // One unreadable body must not hide the rest of the catalog.
    void error
    return undefined
  }
  const content = loaded?.content
  return typeof content === 'string' ? content : undefined
}

async function findProjectRoot(cwd: string, fs: FileSystem | undefined): Promise<string> {
  const start = resolve(cwd)
  let current = start
  while (true) {
    if (await pathExists(join(current, '.git'), fs)) return current
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}

async function pathExists(file: string, fs: FileSystem | undefined): Promise<boolean> {
  if (fs !== undefined) return await pathExistsInFileSystem(file, fs)
  try {
    await access(file)
    return true
  } catch (error: unknown) {
    // Missing host paths are expected while walking toward the filesystem root.
    void error
    return false
  }
}

async function pathExistsInFileSystem(file: string, fs: FileSystem): Promise<boolean> {
  let target
  try {
    target = await fs.resolve(file)
  } catch (error: unknown) {
    // A backend may reject or hide this candidate; continue walking upward.
    void error
    return false
  }
  try {
    return await fs.stat(target) !== undefined
  } catch (error: unknown) {
    // A stat failure makes only this git-root candidate unusable.
    void error
    return false
  }
}

function assertResolvedSkillPath(file: string, workspaceRoot: string, executionPath: string): void {
  if (!isInsidePath(workspaceRoot, executionPath)) {
    throw new RemoteError(
      'gateway/bad-request',
      `skill path "${executionPath}" is outside the session workspace`,
      {},
    )
  }
  const child = relative(dirname(file), executionPath)
  if (child !== basename(file) && !samePath(executionPath, file)) {
    throw new RemoteError(
      'gateway/bad-request',
      `skill path "${executionPath}" is outside ${dirname(file)}`,
      {},
    )
  }
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right)
}

function isInsidePath(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate))
  return relativePath === ''
    || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}
