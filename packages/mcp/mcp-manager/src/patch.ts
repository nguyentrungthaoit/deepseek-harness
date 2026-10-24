/** Comment-preserving profile patch transforms for MCP server entries. */
import { isMap, isSeq } from 'yaml'
import type { Document, YAMLMap, YAMLSeq } from 'yaml'

/** Module specifier of `dsh-mcp-client`, the default MCP row module. */
export const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client'

type Items = YAMLSeq['items']

/** Locate the insert element of a row, as a map.
 * @param items Top-level patch rows.
 * @param row Row index.
 * @param element Element index inside the row's insert sequence.
 * @returns The element map.
 */
function elementAt(items: Items, row: number, element: number): YAMLMap {
  const insert = (items[row] as YAMLMap).get('insert') as YAMLSeq
  return insert.items[element] as YAMLMap
}

/** Append a profile-owned insert row for an MCP server.
 * @param document Parsed profile patch document.
 * @param id Composition entry id.
 * @param name Module specifier of the inserted entry.
 * @param config MCP client configuration.
 */
export function insertServerRow(document: Document.Parsed, id: string, name: string, config: Record<string, unknown>): void {
  document.add(document.createNode({ insert: [{ id, name, config }] }))
}

/** Find the profile's own insert element with an id.
 * @param _document Parsed profile patch document.
 * @param items Top-level patch rows.
 * @param id Composition entry id.
 * @returns Row and element indices, or undefined when the profile does not insert it.
 */
export function findInsertedRow(_document: Document.Parsed, items: Items, id: string): { row: number; element: number } | undefined {
  for (const [row, item] of items.entries()) {
    if (!isMap(item)) continue
    const insert = item.get('insert', true)
    if (!isSeq(insert)) continue
    const element = insert.items.findIndex(entry => isMap(entry) && entry.get('id') === id)
    if (element >= 0) return { row, element }
  }
  return undefined
}

/** Replace an MCP server configuration in the owning patch location.
 * @param document Parsed profile patch document.
 * @param items Top-level patch rows.
 * @param id Composition entry id.
 * @param name Module specifier an override row may name.
 * @param config New MCP client configuration.
 * @param ownership Whether the profile inserted the entry or a layer did.
 */
export function replaceServerConfig(
  document: Document.Parsed, items: Items, id: string, name: string, config: Record<string, unknown>, ownership: 'profile' | 'layer',
): void {
  const node = document.createNode(config)
  if (ownership === 'profile') {
    const found = findInsertedRow(document, items, id)
    if (found === undefined) throw new Error(`MCP server ${id} is not inserted by the profile`)
    elementAt(items, found.row, found.element).set('config', node)
    return
  }
  const target = items.findLast(item => isMap(item) && !item.has('insert') && item.get('id') === id
    && [undefined, name].includes(item.get('name') as string | undefined))
  if (isMap(target)) target.set('config', node)
  else document.add(document.createNode({ id, name, config }))
}

/** Remove an inserted MCP server and every override targeting it.
 * @param document Parsed profile patch document.
 * @param items Top-level patch rows.
 * @param id Composition entry id.
 * @throws When the profile does not insert the id.
 */
export function removeServerRow(document: Document.Parsed, items: Items, id: string): void {
  const found = findInsertedRow(document, items, id)
  if (found === undefined) throw new Error(`MCP server ${id} is not inserted by the profile`)
  const insert = (items[found.row] as YAMLMap).get('insert') as YAMLSeq
  insert.items.splice(found.element, 1)
  if (insert.items.length === 0) items.splice(found.row, 1)
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (isMap(item) && !item.has('insert') && item.get('id') === id) items.splice(index, 1)
  }
}

/** Choose an unused patch id for a server name.
 * @param serverName MCP server name.
 * @param taken Ids already in use.
 * @returns `mcp-<name>` or the first free numbered variant.
 */
export function allocatePatchId(serverName: string, taken: ReadonlySet<string>): string {
  const base = `mcp-${serverName}`
  let candidate = base
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${n}`
  return candidate
}
