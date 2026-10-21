/**
 * `read_document` through a real `sandbox-exec` child. The darwin chain has Seatbelt as its sole rung.
 * Skips with the probe's error text off macOS or when `sandbox-exec` rejects the profile.
 */
import { describeBackend, probeBackend } from './sandbox-backend.ts'
import type { Backend } from './sandbox-backend.ts'

const backend: Backend = {
  name: 'Seatbelt',
  internals: { platform: 'darwin' },
  gate: () => process.platform === 'darwin' ? undefined : `Seatbelt runs only on macOS, this host is ${process.platform}`,
  isRunner: confined => confined.argv[0] === 'sandbox-exec',
}

describeBackend(backend, await probeBackend(backend))
