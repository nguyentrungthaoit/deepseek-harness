/**
 * Connection supervisor: owns the MCP client/transport generations for one
 * plugin instance, keeps the harness tool registry in sync with the live
 * generation, and — when the connection drops — restarts the configured
 * server with bounded exponential backoff.
 *
 * One outage shares one attempt budget (`maxAttempts` consecutive failed
 * attempts, delays doubling from `initialDelayMs` up to `maxDelayMs`). A
 * connection that stays up past the stability window closes the outage, so
 * the next disconnect starts a fresh budget while a crash-looping server —
 * even one whose connects briefly succeed — still exhausts the cap instead of
 * restarting forever. Exhaustion unregisters the server's tools and stops;
 * disposal (including HMR) is the only way back from that state.
 *
 * @module
 */

import { Client, type Transport } from '@modelcontextprotocol/client'
import type { Context } from '@deepseek-ai/cordis'
import { assertNever, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type { McpConnectionStatus, McpFailureReason, McpRetryOutcome, McpServerInfo } from '@deepseek-ai/dsh-mcp-manager/types'
import type { ServerContext } from './server-context.ts'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { createTransport, PidStdioClientTransport } from './transport.ts'
import { syncTools } from './tools.ts'
import type { McpToolInfo, ToolBridgeOptions, ToolDisposers } from './tools.ts'
import type { Config } from './index.ts'

/** Automatic reconnect policy for one MCP server connection. */
export interface ReconnectConfig {
  /** Reconnect automatically after a lost connection (default true). */
  enabled?: boolean
  /** First reconnect delay in milliseconds; doubles per consecutive failed attempt (default 500). */
  initialDelayMs?: number
  /** Backoff ceiling in milliseconds; also the uptime after which the attempt budget resets (default 30000). */
  maxDelayMs?: number
  /** Consecutive failed attempts per outage before giving up for good (default 10). */
  maxAttempts?: number
}

/** Defaults shared by the Config schema and {@link resolveReconnectPolicy}. */
export const RECONNECT_DEFAULTS: Required<ReconnectConfig> = Object.freeze({
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 10,
})

/** Default UTF-8 byte limit for attributed server instructions. */
export const DEFAULT_MAX_INSTRUCTION_BYTES = 32_768

// The SDK's stdio transport owns two two-second termination grace periods.
// Keep one additional second for the process-close event that proves the old
// generation is gone; timing out fails closed instead of overlapping children.
const GENERATION_CLOSE_TIMEOUT_MS = 5_000

/** Fully resolved reconnect policy captured at plugin load. */
export type ResolvedReconnectPolicy = Readonly<Required<ReconnectConfig>>

/**
 * The one explicit resolve step from raw reconnect config to the policy the
 * supervisor runs. Programmatic construction may bypass Schemastery
 * normalization, so every default and bound is re-judged here — misconfiguration
 * fails the plugin instance at load.
 *
 * @param config - Raw `reconnect` config; omission uses the defaults.
 * @param path - Diagnostic prefix naming the config location in thrown messages.
 * @returns The frozen resolved policy.
 */
export function resolveReconnectPolicy(config: ReconnectConfig | undefined, path: string): ResolvedReconnectPolicy {
  if (config !== undefined) {
    for (const key of Object.keys(config)) {
      if (!Object.hasOwn(RECONNECT_DEFAULTS, key)) throw new Error(`${path}.${key} is not a reconnect option`)
    }
  }
  const enabled = config?.enabled ?? RECONNECT_DEFAULTS.enabled
  const initialDelayMs = config?.initialDelayMs ?? RECONNECT_DEFAULTS.initialDelayMs
  const maxDelayMs = config?.maxDelayMs ?? RECONNECT_DEFAULTS.maxDelayMs
  const maxAttempts = config?.maxAttempts ?? RECONNECT_DEFAULTS.maxAttempts
  /* jscpd:ignore-start — domain-specific delay validation parallels llm retry-policy; not extractable */
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`)
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`${path}.maxAttempts must be a positive integer`)
  }
  /* jscpd:ignore-end */
  return Object.freeze({ enabled, initialDelayMs, maxDelayMs, maxAttempts })
}

/** Result from the initial connection attempt, for startup-await semantics. */
export interface ConnectionOutcome {
  /** If the initial connection or tool sync failed, the error; otherwise absent. */
  error?: unknown
}

/** Why a supervised connection stopped connecting on its own. */
export type ConnectionFailure = McpFailureReason

/** Supervisor state as status consumers see it; the one definition lives in `dsh-mcp-manager`. */
export type ConnectionStatus = McpConnectionStatus

/** Name and version the server reported during initialization. */
export type ServerInfo = McpServerInfo

/** Result of {@link ConnectionHandle.retry}. */
export type RetryOutcome = McpRetryOutcome

/** Handle for one plugin instance's supervised connection. */
export interface ConnectionHandle extends ServerContext {
  /**
   * Settles when the first connection attempt completes (success or failure).
   * The supervisor enters its reconnect loop regardless; the caller decides
   * whether a failed startup is fatal via `failOnStartupError`.
   */
  ready: Promise<ConnectionOutcome>
  /**
   * Stop reconnection, close the negotiating transport or live client, wait
   * for the in-flight attempt and queued tool syncs to quiesce, then
   * unregister every tool this server still owns. An unconfirmed close
   * records the child PID in {@link status} and notifies subscribers.
   */
  dispose(): Promise<void>
  /**
   * Read the supervisor state.
   * @returns the current phase with its attempt, timing, and failure details.
   */
  status(): ConnectionStatus
  /**
   * Read the registered tool generation.
   * @returns the listed tools, empty while no generation is registered.
   */
  tools(): readonly McpToolInfo[]
  /**
   * Read the identity of the last connected server.
   * @returns the reported name and version, or undefined before the first connection.
   */
  serverInfo(): ServerInfo | undefined
  /**
   * Observe status, tool, and orphan changes.
   * @param listener - called synchronously after each change.
   * @returns a function that stops the observation.
   */
  subscribe(listener: () => void): () => void
  /**
   * Start a fresh attempt budget now, from `backoff` or a stopped state the
   * supervisor can leave without overlapping server processes.
   * @returns `started`, `busy` while connecting, connected, or closing,
   * `disposed` after disposal, or `needs-restart` after an unconfirmed close.
   */
  retry(): RetryOutcome
}

/** PID of a child spawned by this package's stdio transport, kept after close. */
function childPid(transport: Transport | undefined): number | undefined {
  return transport instanceof PidStdioClientTransport ? transport.spawnedPid : undefined
}

/**
 * Start the supervised connection for one MCP server and keep it alive per
 * the reconnect policy.
 *
 * @param ctx - Cordis context providing the `tools` registry and logger.
 * @param config - Resolved plugin config selecting the transport and server identity.
 * @param policy - Resolved reconnect policy from {@link resolveReconnectPolicy}.
 * @returns Handle with a `ready` promise for startup-await and a `dispose` for teardown.
 */
export function startConnection(ctx: Context, config: Config, policy: ResolvedReconnectPolicy): ConnectionHandle {
  const label = `mcp-client(${config.serverName})`
  const incompleteDisposalMessage = `${label}: transport closure could not be confirmed during disposal — server shutdown may be incomplete`
  const opts: ToolBridgeOptions = {
    registrationFailure: 'contain',
    serverName: config.serverName,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
  }
  // The initial sync uses 'throw' when failOnStartupError is configured, so
  // a registration conflict propagates to the startup-await path. Re-syncs
  // and reconnect syncs always contain conflicts.
  const startupOpts: ToolBridgeOptions = config.failOnStartupError
    ? { ...opts, registrationFailure: 'throw' }
    : opts

  let disposed = false
  const maxInstructionBytes = config.maxInstructionBytes ?? DEFAULT_MAX_INSTRUCTION_BYTES
  let serverInstructions = ''
  /** Current generation: the connecting or connected client; undefined during backoff waits and after final failure. */
  let client: Client | undefined
  /** Transport-aware close operation paired with {@link client}. */
  let closeClient: (() => Promise<boolean>) | undefined
  /** Live tool registrations owned by this server; only {@link enqueueSync} and dispose swap it. */
  let disposers: ToolDisposers = new Map()
  /** Tool listing of the current generation, kept beside {@link disposers}. */
  let tools: McpToolInfo[] = []
  let reconnectTimer: NodeJS.Timeout | undefined
  /** Consecutive failed connection attempts within the current outage. */
  let failedAttempts = 0
  /** When the current generation finished connect + initial sync; undefined while down. */
  let connectedAt: number | undefined
  /** The real error from the first connection attempt, for startup-await diagnostics. */
  let firstAttemptError: unknown
  let phase: ConnectionStatus['state'] = 'connecting'
  let failure: ConnectionFailure = 'attempts-exhausted'
  let lastError: string | undefined
  let retryAt = 0
  let orphanPid: number | undefined
  let info: ServerInfo | undefined
  /** Transport of the newest generation, read for its child PID during disposal. */
  let currentTransport: Transport | undefined
  const listeners = new Set<() => void>()
  function changed(): void {
    for (const listener of [...listeners]) listener()
  }
  function stop(reason: ConnectionFailure): void {
    phase = 'failed'
    failure = reason
    changed()
  }

  /** A generation may act only while it is the current one on a live plugin. */
  const isCurrent = (generation: Client): boolean => !disposed && client === generation

  /**
   * Serializes every syncTools call — initial syncs and notification re-syncs
   * across all generations — so two syncs can never interleave their
   * dispose-previous/register-next swap (which would double-dispose one
   * generation and leak another).
   */
  let syncChain: Promise<void> = Promise.resolve()
  function enqueueSync(generation: Client, syncOpts: ToolBridgeOptions = opts): Promise<void> {
    const run = syncChain.then(async () => {
      if (!isCurrent(generation)) return
      ;({ disposers, tools } = await syncTools(generation, ctx, syncOpts, disposers))
      changed()
    })
    // The chain tail must survive a failed sync; the enqueuing caller owns reporting.
    syncChain = run.catch(() => {})
    return run
  }

  /** One disconnect decision per generation: the isCurrent guard makes racing close/error signals idempotent. */
  function generationDown(generation: Client): void {
    if (!isCurrent(generation)) return
    client = undefined
    closeClient = undefined
    scheduleReconnect()
  }

  /** Decide retry ownership after a failed connection's close barrier settles. */
  function settleFailedGeneration(generation: Client, quiesced: boolean, pid: number | undefined): void {
    if (!isCurrent(generation)) return
    if (!quiesced) {
      client = undefined
      closeClient = undefined
      orphanPid = pid
      ctx.logger.error(`${label}: failed generation could not confirm transport closure — reconnect stopped to avoid overlapping server processes; reload the plugin or restart the Host to retry`)
      stop('closure-unconfirmed')
      return
    }
    generationDown(generation)
  }

  /** Wait for the transport-owned close signal without letting a broken transport wedge teardown forever. */
  function waitForClose(closed: Promise<void>): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => { resolve(false) }, GENERATION_CLOSE_TIMEOUT_MS)
      timeout.unref()
      void closed.then(() => {
        clearTimeout(timeout)
        resolve(true)
      })
    })
  }

  function scheduleReconnect(): void {
    const lostEstablishedConnection = connectedAt !== undefined
    if (!policy.enabled) {
      const message = lostEstablishedConnection
        ? 'connection lost and reconnect is disabled — registered tools will fail until an HMR reload or Host restart'
        : 'connection failed and reconnect is disabled — no tools were registered; reload the plugin or restart the Host to connect'
      ctx.logger.error(`${label}: ${message}`)
      stop('reconnect-disabled')
      return
    }
    // A connection that stayed up past the stability window (= maxDelayMs, the
    // longest backoff spacing) ended the previous outage: start a fresh budget.
    if (connectedAt !== undefined && Date.now() - connectedAt >= policy.maxDelayMs) failedAttempts = 0
    connectedAt = undefined
    failedAttempts += 1
    if (failedAttempts > policy.maxAttempts) {
      // Enqueue the give-up disposal so it cannot race an in-flight sync's
      // phase-2 swap (which checks isCurrent inside the queue).
      syncChain = syncChain.then(() => {
        for (const dispose of disposers.values()) dispose()
        disposers = new Map()
        tools = []
        serverInstructions = ''
        changed()
      })
      ctx.logger.error(`${label}: giving up after ${policy.maxAttempts} consecutive failed reconnect attempts — tools unregistered; reload the plugin or restart the Host to reconnect`)
      stop('attempts-exhausted')
      return
    }
    const delayMs = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (failedAttempts - 1))
    const action = lostEstablishedConnection ? 'connection lost; reconnecting' : 'connection failed; retrying'
    ctx.logger.warn(`${label}: ${action} in ${delayMs}ms (attempt ${failedAttempts}/${policy.maxAttempts})`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      settling = connectGeneration(false)
    }, delayMs)
    // An armed reconnect timer must never hold the process open on its own.
    reconnectTimer.unref()
    phase = 'backoff'
    retryAt = Date.now() + delayMs
    changed()
  }

  /**
   * One connection attempt: fresh transport + client (the MCP SDK binds a
   * Protocol to one transport for life), connect, then queue the initial tool
   * sync. The startup flag belongs to the attempt rather than the shared sync
   * queue, so an early notification cannot consume strict startup semantics.
   * Every failure funnels through {@link generationDown}; success arms the
   * onclose-driven disconnect path. Never rejects.
   *
   * @param startup - Whether this is the plugin's activation attempt.
   */
  async function connectGeneration(startup: boolean): Promise<void> {
    const generation = new Client(
      { name: 'dsh-mcp-client', version: '0.0.1' },
      {
        capabilities: {},
        versionNegotiation: { mode: 'auto' },
        listChanged: {
          tools: {
            autoRefresh: false,
            debounceMs: 0,
            onChanged: () => { void refreshTools() },
          },
        },
      },
    )
    const closed: PromiseWithResolvers<void> = Promise.withResolvers()
    let attemptSettled = false
    let closeObserved = false
    let transport: Transport | undefined
    const hasClosed = (): boolean => closeObserved
    client = generation
    closeClient = closeGeneration
    currentTransport = undefined
    phase = 'connecting'
    changed()
    generation.onclose = () => {
      closeObserved = true
      closed.resolve()
      // A failed connect owns its close barrier in the catch path below. An
      // established generation can transition down directly from this signal.
      if (attemptSettled) generationDown(generation)
    }
    /** Unattached probes close through their transport; attached clients must also report transport closure. */
    async function closeGeneration(): Promise<boolean> {
      const attached = generation.transport !== undefined
      try {
        await (attached ? generation.close() : transport?.close())
      } catch (_error) {
        if (!attached) return hasClosed()
      }
      return !attached || hasClosed() || await waitForClose(closed.promise)
    }
    async function refreshTools(): Promise<void> {
      if (!isCurrent(generation)) return
      ctx.logger.info(`${label}: tool list changed, re-syncing`)
      try {
        await enqueueSync(generation)
      } catch (error) {
        if (!disposed) ctx.logger.error(`${label}: tool re-sync failed: ${String(error)}`)
      }
    }
    let instructions: string
    try {
      transport = createTransport(config)
      currentTransport = transport
      await generation.connect(transport)
      if (hasClosed()) {
        attemptSettled = true
        generationDown(generation)
        return
      }
      if (!isCurrent(generation)) {
        if (!await closeGeneration()) ctx.logger.error(incompleteDisposalMessage)
        return
      }
      const serverText = generation.getInstructions()?.trimEnd() ?? ''
      instructions = serverText ? `### MCP server: ${config.serverName}\n\n${serverText}` : ''
      if (Buffer.byteLength(instructions) > maxInstructionBytes) {
        throw new Error(`${label}: server instructions exceed maxInstructionBytes (${maxInstructionBytes})`)
      }
      await enqueueSync(generation, startup ? startupOpts : opts)
    } catch (error) {
      if (firstAttemptError === undefined) firstAttemptError = error
      // Disposal clears current ownership before it closes the generation, so
      // only a live supervisor reports an attempt failure.
      if (isCurrent(generation)) {
        ctx.logger.warn(`${label}: connection attempt failed: ${String(error)}`)
        lastError = String(error)
        phase = 'closing'
        changed()
      }
      const quiesced = await closeGeneration()
      attemptSettled = true
      const pid = childPid(transport)
      settleFailedGeneration(generation, quiesced, pid)
      if (!quiesced && pid !== undefined) {
        // A close reported after the barrier gave up proves the child is gone.
        void closed.promise.then(() => {
          orphanPid = undefined
          changed()
        })
      }
      return
    }
    attemptSettled = true
    if (hasClosed()) {
      generationDown(generation)
      return
    }
    if (!isCurrent(generation)) return
    serverInstructions = instructions
    connectedAt = Date.now()
    const version = generation.getServerVersion()
    info = version === undefined ? undefined : { name: version.name, version: version.version }
    lastError = undefined
    phase = 'connected'
    changed()
    if (failedAttempts > 0) ctx.logger.info(`${label}: reconnected and re-synced tools (attempt ${failedAttempts}/${policy.maxAttempts})`)
  }

  /** The in-flight (or last settled) connection attempt; dispose awaits it for quiescence. */
  let settling = connectGeneration(true)

  // The ready promise settles when the first attempt finishes (regardless of
  // success). If the first attempt fails and reconnect is enabled, the
  // supervisor is already scheduling a retry — ready just reports the outcome.
  const ready: Promise<ConnectionOutcome> = settling.then(() => {
    // After settling: if client is set the initial connect+sync succeeded.
    // If not, the supervisor either scheduled a retry (error logged) or gave
    // up (error logged). Either way the outcome is reported with the real error.
    // Note: settling.then() is a microtask; stdio onclose is a macrotask — so
    // a server that crashes AFTER a successful initial sync cannot flip client
    // to undefined before this continuation runs.
    if (client !== undefined) return {}
    /* v8 ignore next -- defensive: firstAttemptError is always set when connect/sync fails */
    return { error: firstAttemptError ?? new Error(`${label}: initial connection failed`) }
  })

  return {
    ready,
    instructions: () => serverInstructions,
    resources: {
      async request(request, exec): Promise<JsonValue> {
        const generation = client
        if (!generation || connectedAt === undefined) throw new Error(`${label}: server is disconnected`)
        const options = { signal: exec.signal, timeout: config.toolCallTimeoutMs }
        switch (request.method) {
          case 'resources/list':
            return await generation.listResources(
              request.cursor === undefined ? undefined : { cursor: request.cursor }, options,
            ) as JsonValue
          case 'resources/templates/list':
            return await generation.listResourceTemplates(
              request.cursor === undefined ? undefined : { cursor: request.cursor }, options,
            ) as JsonValue
          case 'resources/read':
            return await generation.readResource({ uri: request.uri }, options) as JsonValue
          /* v8 ignore next 2 -- resource requests are the closed, typed tool operation union */
          default:
            return assertNever(request)
        }
      },
    },
    status(): ConnectionStatus {
      switch (phase) {
        case 'connecting': return { state: 'connecting', attempt: failedAttempts + 1 }
        case 'connected': return { state: 'connected', since: connectedAt as number }
        case 'closing': return { state: 'closing' }
        case 'backoff':
          return { state: 'backoff', attempt: failedAttempts, maxAttempts: policy.maxAttempts, retryAt,
            ...lastError === undefined ? {} : { lastError } }
        case 'failed':
          return { state: 'failed', reason: failure,
            ...lastError === undefined ? {} : { lastError }, ...orphanPid === undefined ? {} : { orphanPid } }
        /* v8 ignore next 2 -- phase is the closed state union */
        default:
          return assertNever(phase)
      }
    },
    tools: () => tools,
    serverInfo: () => info,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    retry(): RetryOutcome {
      if (disposed) return 'disposed'
      if (phase === 'failed' && failure === 'closure-unconfirmed') return 'needs-restart'
      if (phase !== 'backoff' && phase !== 'failed') return 'busy'
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      failedAttempts = 0
      connectedAt = undefined
      settling = connectGeneration(false)
      return 'started'
    },
    async dispose(): Promise<void> {
      disposed = true
      serverInstructions = ''
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      const close = closeClient
      client = undefined
      closeClient = undefined
      if (close !== undefined && !await close()) {
        ctx.logger.error(incompleteDisposalMessage)
        orphanPid = childPid(currentTransport)
        stop('closure-unconfirmed')
      }
      // Quiesce, don't just request it: the in-flight attempt enqueues its
      // sync before settling, so awaiting both leaves `disposers` final.
      await settling
      await syncChain
      for (const dispose of disposers.values()) dispose()
      disposers = new Map()
      tools = []
    },
  }
}
