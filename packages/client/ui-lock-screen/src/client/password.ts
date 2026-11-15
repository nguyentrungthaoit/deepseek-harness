/**
 * PBKDF2-SHA256 password records for the lock screen. The pure-JS hash runs in
 * any page, including plain-HTTP origins where WebCrypto's `subtle` is absent.
 */
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js'

/** Stored verifier: hex salt, the PBKDF2 iteration count, and the hex digest. */
export interface PasswordRecord {
  readonly salt: string
  readonly iterations: number
  readonly digest: string
}

/** PBKDF2 iteration count for new records; existing records keep their own count. */
export const PASSWORD_ITERATIONS = 60_000

/**
 * Derive a verifier for a password.
 * @param password - plain password text.
 * @param iterations - PBKDF2 iteration count.
 * @param salt - hex salt; a fresh 16-byte salt when omitted.
 * @returns the record to persist.
 */
export async function hashPassword(password: string, iterations: number, salt = bytesToHex(randomBytes(16))): Promise<PasswordRecord> {
  const key = await pbkdf2Async(sha256, password, hexToBytes(salt), { c: iterations, dkLen: 32 })
  return { salt, iterations, digest: bytesToHex(key) }
}

/**
 * Check a password against a stored record.
 * @param password - candidate password text.
 * @param record - persisted verifier.
 * @returns whether the candidate derives the stored digest.
 */
export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const candidate = await hashPassword(password, record.iterations, record.salt)
  return candidate.digest === record.digest
}
