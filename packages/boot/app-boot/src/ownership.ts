/** Which profile patch row, if any, owns a composed plugin entry. */
import type { Entry, EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

/** Why a composed plugin entry cannot be changed through the profile patch. */
export type EntryReadOnlyReason = 'management-required' | 'unaddressable'

/**
 * Flatten the groups addressable by the profile's patch composer.
 * @param rows - composed rows, possibly holding native groups with nested rows.
 * @returns every row, each group followed by its nested rows.
 */
export function flattenEntries(rows: readonly EntryOptions[]): EntryOptions[] {
  return rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? flattenEntries(row.config as EntryOptions[]) : [])])
}

/**
 * Decide, for each runtime plugin entry, the profile patch row that owns it or why none can.
 * @param items - runtime entries, each naming its Loader entry id and plugin module.
 * @param rows - the flattened composed rows of the profile.
 * @param entries - the live Loader entries the items are matched against by id.
 * @param options - modules and the owning entry that only management bundles may change.
 * @returns each item with `patchId` when exactly one same-named row under the profile's include owns it, else
 * `readOnlyReason`: `management-required` for a protected module or the owner entry, `unaddressable` otherwise.
 */
export function resolveEntryOwnership<T extends { entryId: string; moduleName: string }>(
  items: readonly T[], rows: readonly EntryOptions[], entries: Iterable<Entry>,
  options: { protectedModules: ReadonlySet<string>; ownerEntryId?: string | undefined },
): Array<T & ({ patchId: string } | { readOnlyReason: EntryReadOnlyReason })> {
  const live = [...entries]
  return items.map((item) => {
    if (options.protectedModules.has(item.moduleName) || item.entryId === options.ownerEntryId) {
      return { ...item, readOnlyReason: 'management-required' as const }
    }
    const actual = live.find(row => row.id === item.entryId)
    const candidates = rows.filter(row => row.id === actual?.options.id)
    const candidate = candidates[0]
    if (candidate === undefined || candidates.length > 1 || candidate.name !== item.moduleName
      || actual?.parent.tree.ctx.fiber.entry?.id !== 'include') {
      return { ...item, readOnlyReason: 'unaddressable' as const }
    }
    return { ...item, patchId: candidate.id }
  })
}
