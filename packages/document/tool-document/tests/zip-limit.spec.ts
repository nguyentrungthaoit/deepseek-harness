/** ZIP limits use the central directory and reject corrupt archives before inflation. */
import { expect, it } from 'vitest'
import { assertZipLimits } from '../src/zip-limit.ts'

interface Member {
  name: string
  data: Uint8Array
  method?: number
  localUncompressed?: number
  centralUncompressed?: number
  zip64Uncompressed?: number
  /** 32-bit uncompressed size is the ZIP64 sentinel and no ZIP64 extra field is present. */
  zip64Sentinel?: boolean
}

function limits(maxArchiveEntries: number, maxUncompressedBytes: number): { maxArchiveEntries: number; maxUncompressedBytes: number } {
  return { maxArchiveEntries, maxUncompressedBytes }
}

function archive(entries: readonly Member[], comment = ''): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const data = Buffer.from(entry.data)
    const method = entry.method ?? 0
    const localUncompressed = entry.localUncompressed ?? data.length
    const centralUncompressed = entry.zip64Uncompressed ?? entry.centralUncompressed ?? localUncompressed
    const extra = entry.zip64Uncompressed === undefined ? Buffer.alloc(0) : zip64Extra(entry.zip64Uncompressed)
    const centralField = entry.zip64Uncompressed !== undefined || entry.zip64Sentinel === true
      ? 0xffffffff
      : centralUncompressed
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(localUncompressed, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    locals.push(local, data)
    const central = Buffer.alloc(46 + name.length + extra.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(centralField, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(extra.length, 30)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    extra.copy(central, 46 + name.length)
    centrals.push(central)
    offset += local.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const commentBytes = Buffer.from(comment)
  const eocd = Buffer.alloc(22 + commentBytes.length)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(commentBytes.length, 20)
  commentBytes.copy(eocd, 22)
  return Buffer.concat([...locals, directory, eocd])
}

function zip64Extra(size: number): Buffer {
  const extra = Buffer.alloc(12)
  extra.writeUInt16LE(0x0001, 0)
  extra.writeUInt16LE(8, 2)
  extra.writeBigUInt64LE(BigInt(size), 4)
  return extra
}

function zip64Single(uncompressed: number): Uint8Array {
  const central = Buffer.alloc(47)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(uncompressed, 24)
  central.writeUInt16LE(1, 28)
  central.writeUInt8(0x61, 46)
  const record = Buffer.alloc(56)
  record.writeUInt32LE(0x06064b50, 0)
  record.writeBigUInt64LE(44n, 4)
  record.writeUInt16LE(45, 12)
  record.writeUInt16LE(45, 14)
  record.writeBigUInt64LE(1n, 24)
  record.writeBigUInt64LE(1n, 32)
  record.writeBigUInt64LE(BigInt(central.length), 40)
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  locator.writeBigUInt64LE(BigInt(central.length), 8)
  locator.writeUInt32LE(1, 16)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0xffff, 4)
  eocd.writeUInt16LE(0xffff, 6)
  eocd.writeUInt16LE(0xffff, 8)
  eocd.writeUInt16LE(0xffff, 10)
  eocd.writeUInt32LE(0xffffffff, 12)
  eocd.writeUInt32LE(0xffffffff, 16)
  return Buffer.concat([central, record, locator, eocd])
}

it('allows an archive at the caps and rejects one past either cap', () => {
  const bytes = archive([
    { name: 'a.xml', data: Uint8Array.of(1, 2) },
    { name: 'b.xml', data: Uint8Array.of(3, 4, 5) },
  ], 'tail')
  expect(() => { assertZipLimits(bytes, limits(2, 5)) }).not.toThrow()
  expect(() => { assertZipLimits(bytes, limits(1, 5)) }).toThrow('maxArchiveEntries')
  expect(() => { assertZipLimits(bytes, limits(2, 4)) }).toThrow('maxUncompressedBytes')
  expect(() => { assertZipLimits(archive([]), limits(0, 0)) }).not.toThrow()
})

it('reads declared central-directory sizes, including ZIP64, and does not inflate entry data', () => {
  const declared = archive([{
    name: 'a.xml',
    data: Uint8Array.of(1, 2),
    localUncompressed: 1,
    centralUncompressed: 80,
  }])
  expect(() => { assertZipLimits(declared, limits(1, 80)) }).not.toThrow()
  expect(() => { assertZipLimits(declared, limits(1, 79)) }).toThrow('maxUncompressedBytes')

  const zip64 = archive([{ name: 'a.xml', data: Uint8Array.of(1), zip64Uncompressed: 50 }])
  expect(() => { assertZipLimits(zip64, limits(1, 50)) }).not.toThrow()
  expect(() => { assertZipLimits(zip64, limits(1, 49)) }).toThrow('maxUncompressedBytes')
  expect(() => { assertZipLimits(zip64Single(7), limits(1, 7)) }).not.toThrow()
  expect(() => { assertZipLimits(zip64Single(7), limits(1, 6)) }).toThrow('maxUncompressedBytes')

  const deflated = archive([{
    name: 'a.xml',
    data: Uint8Array.of(0xff, 0xff, 0xff, 0xff),
    method: 8,
    centralUncompressed: 1000,
  }])
  expect(() => { assertZipLimits(deflated, limits(1, 1000)) }).not.toThrow()
  expect(() => { assertZipLimits(deflated, limits(1, 999)) }).toThrow('maxUncompressedBytes')
})

it('reads a byte view and ignores bytes outside that view', () => {
  const bytes = archive([{ name: 'a.xml', data: Uint8Array.of(9) }])
  const padded = new Uint8Array(bytes.length + 8)
  padded.fill(0xff)
  padded.set(bytes, 3)
  const view = padded.subarray(3, 3 + bytes.length)
  expect(view.byteOffset).not.toBe(0)
  expect(() => { assertZipLimits(view, limits(1, 1)) }).not.toThrow()
  expect(() => { assertZipLimits(view, limits(1, 0)) }).toThrow('maxUncompressedBytes')
})

it('rejects a corrupt central directory', () => {
  const open = limits(10, 1000)
  expect(() => { assertZipLimits(new Uint8Array(), open) }).toThrow('corrupt')
  expect(() => { assertZipLimits(Uint8Array.of(0x50, 0x4b, 0x05, 0x06), open) }).toThrow('corrupt')
  const missingDirectory = Buffer.alloc(22)
  missingDirectory.writeUInt32LE(0x06054b50, 0)
  missingDirectory.writeUInt16LE(1, 8)
  missingDirectory.writeUInt16LE(1, 10)
  missingDirectory.writeUInt32LE(46, 12)
  expect(() => { assertZipLimits(missingDirectory, open) }).toThrow('corrupt')
  const zeros = Buffer.alloc(46 + 22)
  zeros.writeUInt32LE(0x06054b50, 46)
  zeros.writeUInt16LE(1, 54)
  zeros.writeUInt16LE(1, 56)
  zeros.writeUInt32LE(46, 58)
  expect(() => { assertZipLimits(zeros, open) }).toThrow('corrupt')
  const missingZip64 = archive([{ name: 'a.xml', data: Uint8Array.of(1), zip64Sentinel: true }])
  expect(() => { assertZipLimits(missingZip64, open) }).toThrow('corrupt')
  const locator = zip64Single(7)
  locator[locator.length - 22 - 20] = 0
  expect(() => { assertZipLimits(locator, open) }).toThrow('corrupt')
})

/** Byte offsets inside {@link zip64Single}: central entry, ZIP64 record, locator, then EOCD. */
const RECORD = 47
const LOCATOR = RECORD + 56
const EOCD = LOCATOR + 20

function patched(edit: (bytes: Buffer) => void, base: Uint8Array = zip64Single(7)): Buffer {
  const bytes = Buffer.from(base)
  edit(bytes)
  return bytes
}

it('rejects a corrupt ZIP64 locator or record', () => {
  const open = limits(10, 1000)
  const huge = 2n ** 60n
  const zip64Eocd = Buffer.alloc(22)
  zip64Eocd.writeUInt32LE(0x06054b50, 0)
  zip64Eocd.writeUInt16LE(0xffff, 10)
  expect(() => { assertZipLimits(zip64Eocd, open) }).toThrow('corrupt')
  const cases: Array<(bytes: Buffer) => void> = [
    (bytes) => { bytes.writeUInt32LE(1, LOCATOR + 4) },
    (bytes) => { bytes.writeUInt32LE(2, LOCATOR + 16) },
    (bytes) => { bytes.writeBigUInt64LE(huge, LOCATOR + 8) },
    (bytes) => { bytes.writeBigUInt64LE(10_000n, LOCATOR + 8) },
    (bytes) => { bytes.writeBigUInt64LE(0n, LOCATOR + 8) },
    (bytes) => { bytes.writeBigUInt64LE(10n, RECORD + 4) },
    (bytes) => { bytes.writeBigUInt64LE(10_000n, RECORD + 4) },
    (bytes) => { bytes.writeUInt32LE(1, RECORD + 16) },
    (bytes) => { bytes.writeUInt32LE(1, RECORD + 20) },
    (bytes) => { bytes.writeBigUInt64LE(2n, RECORD + 24) },
    (bytes) => {
      bytes.writeBigUInt64LE(huge, RECORD + 24)
      bytes.writeBigUInt64LE(huge, RECORD + 32)
    },
    (bytes) => { bytes.writeBigUInt64LE(huge, RECORD + 48) },
    (bytes) => { bytes.writeBigUInt64LE(huge, RECORD + 40) },
  ]
  for (const edit of cases) expect(() => { assertZipLimits(patched(edit), open) }).toThrow('corrupt')
  expect(EOCD + 22).toBe(zip64Single(7).length)
})

it('rejects a directory whose entries do not fill it exactly or overrun it', () => {
  const open = limits(10, 1000)
  const one = Buffer.from(archive([{ name: 'a.xml', data: Uint8Array.of(1) }]))
  const eocd = one.length - 22
  const central = one.readUInt32LE(eocd + 16)
  const size = one.readUInt32LE(eocd + 12)
  expect(() => { assertZipLimits(patched((bytes) => { bytes.writeUInt32LE(size + 1, eocd + 12) }, one), open) }).toThrow('corrupt')
  expect(() => { assertZipLimits(patched((bytes) => { bytes.writeUInt16LE(2, eocd + 10) }, one), open) }).toThrow('corrupt')
  expect(() => { assertZipLimits(patched((bytes) => { bytes.writeUInt16LE(1, eocd + 4) }, one), open) }).toThrow('corrupt')
  expect(() => { assertZipLimits(patched((bytes) => { bytes.writeUInt16LE(1, eocd + 6) }, one), open) }).toThrow('corrupt')
  expect(() => { assertZipLimits(patched((bytes) => { bytes.writeUInt16LE(500, central + 28) }, one), open) }).toThrow('corrupt')
})

it('walks ZIP64 extra fields and rejects malformed ones', () => {
  const open = limits(10, 1000)
  const other = Buffer.alloc(8)
  other.writeUInt16LE(0x7875, 0)
  other.writeUInt16LE(4, 2)
  const sized = Buffer.alloc(12)
  sized.writeUInt16LE(0x0001, 0)
  sized.writeUInt16LE(8, 2)
  sized.writeBigUInt64LE(30n, 4)
  expect(() => { assertZipLimits(withExtra(Buffer.concat([other, sized])), limits(1, 30)) }).not.toThrow()
  expect(() => { assertZipLimits(withExtra(Buffer.concat([other, sized])), limits(1, 29)) }).toThrow('maxUncompressedBytes')
  const overrun = Buffer.alloc(4)
  overrun.writeUInt16LE(0x0001, 0)
  overrun.writeUInt16LE(20, 2)
  expect(() => { assertZipLimits(withExtra(overrun), open) }).toThrow('corrupt')
  const short = Buffer.alloc(8)
  short.writeUInt16LE(0x0001, 0)
  short.writeUInt16LE(4, 2)
  expect(() => { assertZipLimits(withExtra(short), open) }).toThrow('corrupt')
})

it('skips an EOCD signature inside the comment and rejects bytes with no EOCD', () => {
  const comment = `PK\u0005\u0006${'x'.repeat(26)}`
  expect(() => { assertZipLimits(archive([{ name: 'a.xml', data: Uint8Array.of(1) }], comment), limits(1, 1)) }).not.toThrow()
  expect(() => { assertZipLimits(Buffer.alloc(40), limits(1, 1)) }).toThrow('corrupt')
})

/** One stored entry whose 32-bit uncompressed size is the ZIP64 sentinel, with the given central extra field. */
function withExtra(extra: Buffer): Uint8Array {
  const central = Buffer.alloc(47 + extra.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt32LE(0xffffffff, 24)
  central.writeUInt16LE(1, 28)
  central.writeUInt16LE(extra.length, 30)
  central.writeUInt8(0x61, 46)
  extra.copy(central, 47)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  return Buffer.concat([central, eocd])
}
