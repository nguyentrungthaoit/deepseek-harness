/**
 * Shared driver for in-process ONE-SHOT subagent providers. The agent factory's
 * creation transaction owns unpublished setup and rollback; after publication
 * the returned AgentHandle is the one quiescent lifecycle owner held by the
 * provider's caller.
 *
 * Continuable children never come through here: the continuation manager
 * composes and drives them directly, so this driver owns exactly one turn with
 * one result.
 *
 * @module @deepseek-ai/dsh-subagent-in-process-driver
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { foldConsumedWork } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId, SessionLogOffset as SessionLogOffsetType, TurnEndReason } from '@deepseek-ai/dsh-session'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { isUserInvocable, type SkillSummary } from '@deepseek-ai/dsh-skill'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  assertSubagentMaxDepth,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  finalAssistantOutput,
  resolveChildAgentOptions,
  resolveChildDepth,
} from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentDescriptorData,
  SubagentResult,
  SubagentRun,
  SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import {
  attachStructuredRuntime,
  type StructuredAttachment,
} from './structured.ts'

export {
  STRUCTURED_OUTPUT_TOOL,
  STRUCTURED_OUTPUT_INSTRUCTION,
} from './structured.ts'

/** Map a session turn outcome to the subagent seam's terminal vocabulary. */
function toStopReason(reason: TurnEndReason | undefined): SubagentStopReason {
  switch (reason?.kind) {
    case 'completed':
      return 'completed'
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
      return 'aborted'
    // A pre-step rejection discarded the claimed prompt: the task was
    // declined, and the caller must not read the run as done.
    case 'blocked':
      return 'refusal'
    case 'error':
    case 'interrupted':
    default:
      return 'error'
  }
}

/** Extra inputs the spawn and fork providers supply to the shared driver. */
export interface InProcessRunOptions {
  /** Completed-turn seed for fork, or undefined for a fresh spawn. */
  readonly seed?: readonly SessionEvent[]
}

/** Error used when cancellation wins before the child publication boundary. */
function prePublicationAbort(): Error {
  return new Error('subagent request was aborted before child publication')
}

/** Append one one-shot descriptor inside the child's initial turn before its first request. */
function attachDescriptorAppend(childCtx: Context, descriptor: SubagentDescriptorData): void {
  let appended = false
  childCtx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (!appended && decision.kind === 'enter') {
      appended = true
      agent.session.append('subagent/descriptor', descriptor)
    }
    return decision
  })
}

/**
 * Establish and drive one in-process one-shot child. Fulfillment means the agent
 * is already published in the registry and transfers its turn, cancellation,
 * and disposal work through the returned run. Rejection means the agent
 * factory's unpublished creation transaction reached quiescence without
 * publishing a child. Every start appends its resolved descriptor inside the
 * child's initial turn.
 * @param request - the trusted typed start request, including its required signal.
 * @param options - the optional fork seed.
 * @returns a published holder-owned run.
 */
export async function startInProcessRun(
  request: ResolvedSubagentStartRequest,
  options: InProcessRunOptions,
): Promise<SubagentRun> {
  assertSubagentMaxDepth(request.maxDepth)
  if (request.signal.aborted) throw prePublicationAbort()
  const parent = request.parent
  const childDepth = resolveChildDepth(parent, request.maxDepth)

  const childId = brandString<SessionId>(randomUUID())
  const seed = options.seed
  const activationBoundary = SessionLogOffset(seed?.length ?? 0)

  // Capture before the first await: a later parent switch belongs to the
  // parent's future.
  const inherited = captureDelegatedPolicyOverrides(parent)

  let structured: StructuredAttachment | undefined
  const setup = (childCtx: Context, child: Agent): void => {
    appendDelegatedPolicyOverrides(child.session, inherited)
    applyChildComposition(childCtx, parent, {
      persona: request.persona,
      toolFilter: request.toolFilter,
    })
    if (request.outputSchema !== undefined) {
      structured = attachStructuredRuntime(childCtx, request.outputSchema)
    }
    attachDescriptorAppend(childCtx, request.descriptor)
  }

  const handle = await parent.ctx.agents.create({
    sessionId: childId,
    parentAgent: parent,
    meta: childSessionMeta(parent, childDepth, seed !== undefined),
    ...seed !== undefined ? { seed } : {},
    ...seed === undefined ? {} : { inheritedEventCount: activationBoundary },
    agentOptions: resolveChildAgentOptions(parent, request.agentOptions, childDepth),
    signal: request.signal,
    setup,
  })
  return drivePublishedRun(
    handle,
    request.signal,
    request.prompt,
    childId,
    activationBoundary,
    structured,
  )
}

/**
 * Task content with pinned `/name` tokens, or `prompt` unchanged when the
 * registry is absent, no skill is pinned, or listing fails.
 * @param child - published child; its cwd and agent scope select the catalog.
 * @param prompt - the caller's task content.
 * @param signal - run cancellation, forwarded to skill listing.
 * @returns the content sent as the child's user message.
 */
async function promptWithPinnedSkills(
  child: Agent,
  prompt: ContentBlock[],
  signal: AbortSignal,
): Promise<ContentBlock[]> {
  const skills = child.ctx.get('skills')
  if (skills === undefined) return prompt
  let listed: readonly SkillSummary[]
  try {
    listed = await skills.list({
      cwd: child.session.header.cwd,
      scope: child,
      signal,
    })
  } catch (error: unknown) {
    child.ctx.logger.warn(`subagent-in-process-driver: skill listing failed: ${String(error)}`)
    return prompt
  }
  const names = listed.filter(isPinnedSubagentSkill).map(skill => skill.name).sort(compareCodeUnits)
  return appendPinnedSkillLine(prompt, names)
}

/** User-invocable skill explicitly marked for in-process children. A missing `subagent` field is not pinned. */
function isPinnedSubagentSkill(skill: SkillSummary): boolean {
  if (!isUserInvocable(skill)) return false
  if (!('subagent' in skill)) return false
  return skill.subagent === true
}

/** Locale-independent code-unit order, the same order `ctx.skills.list()` already uses. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * One trailing line of space-separated `/name` tokens.
 * An empty `names` list returns `prompt` itself.
 * @param prompt - the caller's task content.
 * @param names - pinned skill names in the order to emit.
 * @returns the task content the child should receive.
 */
function appendPinnedSkillLine(prompt: ContentBlock[], names: readonly string[]): ContentBlock[] {
  if (names.length === 0) return prompt
  const line = names.map(name => `/${name}`).join(' ')
  const last = prompt.at(-1)
  if (last?.type === 'text' && last.text.length > 0) {
    const text = last.text.endsWith('\n') ? `${last.text}${line}` : `${last.text}\n${line}`
    return [...prompt.slice(0, -1), { type: 'text', text }]
  }
  const kept = last?.type === 'text' ? prompt.slice(0, -1) : prompt
  return [...kept, { type: 'text', text: line }]
}

/**
 * Wrap a published child in the single run lifecycle that owns signal handoff,
 * one turn, result settlement, and quiescent disposal.
 */
function drivePublishedRun(
  handle: AgentHandle,
  signal: AbortSignal,
  prompt: ContentBlock[],
  childId: SessionId,
  boundary: SessionLogOffsetType,
  structured: StructuredAttachment | undefined,
): SubagentRun {
  const child = handle.agent
  const flags = { cancelled: false }
  const onAbort = (): void => {
    flags.cancelled = true
    child.cancel({ kind: 'parent' })
  }
  signal.addEventListener('abort', onAbort, { once: true })
  // Agent creation detaches its creation-only listener before returning. The
  // post-registration check closes that handoff without treating an already
  // published child as a failed start.
  if (signal.aborted) onAbort()

  const result: Promise<SubagentResult> = (async () => {
    try {
      if (!flags.cancelled) {
        const content = await promptWithPinnedSkills(child, prompt, signal)
        child.followup(createUserMessage({ content, source: { kind: 'user' } }))
        await child.whenIdle()
      }
      return readResult(
        child,
        boundary,
        flags.cancelled,
        structured ? { captured: structured.captured() } : undefined,
      )
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  })()

  return {
    id: childId,
    localAgent: child,
    result,
    async dispose(): Promise<void> {
      signal.removeEventListener('abort', onAbort)
      flags.cancelled = true
      const settlements = await Promise.allSettled([handle.dispose(), result])
      const disposal = settlements[0]
      // The result channel owns run faults; disposal reports only failure to
      // release the published handle after both operations settle.
      if (disposal.status === 'rejected') throw disposal.reason
    },
  }
}

/** Read one settled child's result from events after its activation boundary. */
function readResult(
  child: Agent,
  boundary: SessionLogOffsetType,
  cancelled: boolean,
  structured?: { captured?: { value: unknown } | undefined },
): SubagentResult {
  const own = child.session.snapshotEvents(boundary)
  // `droppedUnrun` is deliberately unread: a one-shot prompt is claimed by its
  // awaited first turn almost immediately, and the owner's own teardown is the
  // `cancelled` flag below. A cancellation with no accounting turn resolves
  // `error` through `toStopReason(undefined)`, which never overstates success.
  const lastEnd = foldConsumedWork(own).end
  // The seam's canonical selection rule; a partial answer survives cancel and truncation.
  const output: readonly ContentBlock[] = finalAssistantOutput(own) ?? []
  const recorded = toStopReason(lastEnd?.data.reason)
  // Disposal can tear the owner down before the loop records its ordinary
  // `aborted` end, yielding `disposed` instead.
  const stopReason: SubagentStopReason = cancelled && recorded !== 'completed' ? 'aborted' : recorded
  if (structured !== undefined) {
    if (structured.captured !== undefined) {
      return { output, structured: structured.captured.value, stopReason }
    }
    if (stopReason === 'completed') return { output, stopReason: cancelled ? 'aborted' : 'error' }
  }
  return { output, stopReason }
}
