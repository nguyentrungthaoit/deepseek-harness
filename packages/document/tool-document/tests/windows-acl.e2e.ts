/**
 * `read_document` through the real Windows restricted-token runner. `read_document` confines its
 * child `read-only`, which creates no write grants and changes no ACL, so no one-time admin step
 * applies. Skips off Windows, or with the probe's exact error text when the runner cannot start
 * `node -e 0` under its Low-integrity token.
 */
import { describeBackend, probeBackend } from './sandbox-backend.ts'
import type { Backend } from './sandbox-backend.ts'

const backend: Backend = {
  name: 'Windows ACL',
  internals: { platform: 'win32' },
  gate: () => process.platform === 'win32' ? undefined : `the Windows ACL runner runs only on Windows, this host is ${process.platform}`,
  isRunner: confined => confined.argv.some(part => /sandbox-windows-acl[\\/]/u.test(part)) && confined.argv.includes('--mode'),
}

describeBackend(backend, await probeBackend(backend))
