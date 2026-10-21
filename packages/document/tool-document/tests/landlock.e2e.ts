/**
 * `read_document` through the real `landlock-run` launcher. bwrap is forced off so the Landlock rung
 * is probed and selected. Skips with the probe's error text when the kernel does not enforce Landlock
 * or the launcher is not built.
 */
import { basename } from 'node:path'
import { describeBackend, probeBackend } from './sandbox-backend.ts'
import type { Backend } from './sandbox-backend.ts'

const backend: Backend = {
  name: 'Landlock',
  internals: { platform: 'linux', probeBwrap: () => false },
  gate: () => process.platform === 'linux' ? undefined : `Landlock runs only on Linux, this host is ${process.platform}`,
  isRunner: confined => basename(confined.argv[0] ?? '') === 'landlock-run',
}

describeBackend(backend, await probeBackend(backend))
