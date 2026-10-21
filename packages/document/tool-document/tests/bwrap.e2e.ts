/**
 * `read_document` through a real bwrap child. Landlock is forced off so only the bwrap rung can win
 * on Linux. Skips with the probe's error text when bwrap or user namespaces are unavailable.
 */
import { describeBackend, probeBackend } from './sandbox-backend.ts'
import type { Backend } from './sandbox-backend.ts'

const backend: Backend = {
  name: 'bwrap',
  internals: { platform: 'linux', probeLandlock: () => 'unusable' },
  gate: () => process.platform === 'linux' ? undefined : `bwrap runs only on Linux, this host is ${process.platform}`,
  isRunner: confined => confined.argv[0] === 'bwrap',
}

describeBackend(backend, await probeBackend(backend))
