/**
 * ZIP central-directory limits for docx and xlsx.
 * Entry counts and declared uncompressed sizes come from the central directory.
 * Entry bytes are not inflated.
 * @module @deepseek-ai/dsh-tool-document/zip-limit
 */

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const CENTRAL_SIGNATURE = 0x02014b50
const ZIP64_EXTRA_ID = 0x0001
const MAX_COMMENT = 65_535

/**
 * Reject a ZIP whose central directory is corrupt or declares too many entries or too many uncompressed bytes.
 * The check reads the end-of-central-directory record and the central directory only.
 * @param bytes - ZIP archive bytes, including a view into a larger buffer.
 * @param caps - maximum entry count and total declared uncompressed size. A value equal to a cap is allowed.
 */
export function assertZipLimits(
  bytes: Uint8Array,
  caps: { maxArchiveEntries: number; maxUncompressedBytes: number },
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const directory = centralDirectory(view)
  if (directory.entryCount > caps.maxArchiveEntries) {
    throw new Error('ZIP entry count exceeds maxArchiveEntries.')
  }
  const cap = BigInt(caps.maxUncompressedBytes)
  let offset = directory.start
  let total = 0n
  for (let index = 0; index < directory.entryCount; index += 1) {
    const entry = centralEntry(view, offset, directory.end)
    offset = entry.next
    total += entry.uncompressed
    if (total > cap) throw new Error('ZIP uncompressed size exceeds maxUncompressedBytes.')
  }
  if (offset !== directory.end) throw corruptZip()
}

interface Directory {
  entryCount: number
  start: number
  end: number
}

function centralDirectory(view: DataView): Directory {
  const eocd = locateEocd(view)
  const disk = view.getUint16(eocd + 4, true)
  const diskWithDirectory = view.getUint16(eocd + 6, true)
  const entriesOnDisk = view.getUint16(eocd + 8, true)
  const entries = view.getUint16(eocd + 10, true)
  const size = view.getUint32(eocd + 12, true)
  const offset = view.getUint32(eocd + 16, true)
  const zip64 = disk === 0xffff || diskWithDirectory === 0xffff || entriesOnDisk === 0xffff
    || entries === 0xffff || size === 0xffffffff || offset === 0xffffffff
  if (!zip64) {
    if (disk !== 0 || diskWithDirectory !== 0) throw corruptZip()
    const span = spanOf(BigInt(offset), BigInt(size), view.byteLength)
    return { entryCount: entries, start: span.start, end: span.end }
  }
  return zip64Directory(view, eocd)
}

function zip64Directory(view: DataView, eocd: number): Directory {
  if (eocd < 20) throw corruptZip()
  const locator = eocd - 20
  if (view.getUint32(locator, true) !== ZIP64_LOCATOR_SIGNATURE) throw corruptZip()
  if (view.getUint32(locator + 4, true) !== 0 || view.getUint32(locator + 16, true) > 1) throw corruptZip()
  const recordOffset = view.getBigUint64(locator + 8, true)
  if (recordOffset < 0n || recordOffset > BigInt(Number.MAX_SAFE_INTEGER)) throw corruptZip()
  const record = Number(recordOffset)
  if (record + 56 > view.byteLength) throw corruptZip()
  if (view.getUint32(record, true) !== ZIP64_EOCD_SIGNATURE) throw corruptZip()
  const recordSize = view.getBigUint64(record + 4, true)
  if (recordSize < 44n || recordOffset + 12n + recordSize > BigInt(view.byteLength)) throw corruptZip()
  if (view.getUint32(record + 16, true) !== 0 || view.getUint32(record + 20, true) !== 0) throw corruptZip()
  const entriesOnDisk = view.getBigUint64(record + 24, true)
  const entryCount = view.getBigUint64(record + 32, true)
  if (entriesOnDisk !== entryCount || entryCount > BigInt(Number.MAX_SAFE_INTEGER)) throw corruptZip()
  const span = spanOf(view.getBigUint64(record + 48, true), view.getBigUint64(record + 40, true), view.byteLength)
  return { entryCount: Number(entryCount), start: span.start, end: span.end }
}

function centralEntry(view: DataView, offset: number, end: number): { next: number; uncompressed: bigint } {
  if (offset < 0 || end - offset < 46) throw corruptZip()
  if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) throw corruptZip()
  const uncompressed = view.getUint32(offset + 24, true)
  const nameLength = view.getUint16(offset + 28, true)
  const extraLength = view.getUint16(offset + 30, true)
  const commentLength = view.getUint16(offset + 32, true)
  const next = offset + 46 + nameLength + extraLength + commentLength
  if (!Number.isSafeInteger(next) || next < offset || next > end) throw corruptZip()
  const size = uncompressed === 0xffffffff
    ? zip64Uncompressed(view, offset + 46 + nameLength, extraLength)
    : BigInt(uncompressed)
  return { next, uncompressed: size }
}

function zip64Uncompressed(view: DataView, extraStart: number, extraLength: number): bigint {
  let cursor = extraStart
  const extraEnd = extraStart + extraLength
  while (cursor + 4 <= extraEnd) {
    const id = view.getUint16(cursor, true)
    const size = view.getUint16(cursor + 2, true)
    const data = cursor + 4
    if (data + size > extraEnd) throw corruptZip()
    // The uncompressed size is the first ZIP64 field when the 32-bit size is 0xffffffff.
    if (id === ZIP64_EXTRA_ID) {
      if (size < 8) throw corruptZip()
      return view.getBigUint64(data, true)
    }
    cursor = data + size
  }
  throw corruptZip()
}

function locateEocd(view: DataView): number {
  if (view.byteLength < 22) throw corruptZip()
  const start = Math.max(0, view.byteLength - 22 - MAX_COMMENT)
  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue
    const commentLength = view.getUint16(offset + 20, true)
    if (offset + 22 + commentLength === view.byteLength) return offset
  }
  throw corruptZip()
}

function spanOf(offset: bigint, size: bigint, length: number): { start: number; end: number } {
  if (offset < 0n || size < 0n) throw corruptZip()
  if (offset > BigInt(Number.MAX_SAFE_INTEGER) || size > BigInt(Number.MAX_SAFE_INTEGER)) throw corruptZip()
  const start = Number(offset)
  const end = start + Number(size)
  if (!Number.isSafeInteger(end) || end > length) throw corruptZip()
  return { start, end }
}

function corruptZip(): Error {
  return new Error('ZIP central directory is corrupt.')
}
