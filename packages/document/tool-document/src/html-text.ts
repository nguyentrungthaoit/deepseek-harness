/**
 * Plain text from the HTML Mammoth writes for a DOCX package.
 * Paragraphs, headings, and list items become lines. Table cells in a row are joined with tabs, and rows with newlines.
 * Images and form inputs contribute nothing. The parser is lenient: malformed markup ends parsing instead of throwing.
 * @module @deepseek-ai/dsh-tool-document/html-text
 */

const PARAGRAPH_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'])
const VOID_TAGS = new Set(['area', 'br', 'hr', 'img', 'input', 'link', 'meta'])

interface HtmlElement {
  tag: string
  children: HtmlNode[]
}

interface HtmlText {
  text: string
}

type HtmlNode = HtmlElement | HtmlText

/**
 * Convert HTML to plain text lines.
 * @param html - HTML from Mammoth. Comments, doctypes, and processing instructions are skipped.
 * @returns text with one line per block and tab-separated table cells. It contains no HTML tags.
 */
export function htmlText(html: string): string {
  return blockLines(parseHtml(html)).join('\n')
}

function blockLines(nodes: readonly HtmlNode[]): string[] {
  const lines: string[] = []
  for (const node of nodes) {
    if (!isElement(node)) {
      const text = node.text.trim()
      if (text.length > 0) lines.push(text)
      continue
    }
    if (node.tag === 'table') {
      const table = tableText(node)
      if (table.length > 0) lines.push(table)
      continue
    }
    if (PARAGRAPH_TAGS.has(node.tag)) {
      for (const line of paragraphLines(node)) lines.push(line)
      continue
    }
    if (node.tag === 'img' || node.tag === 'br' || node.tag === 'input') continue
    for (const line of blockLines(node.children)) lines.push(line)
  }
  return lines
}

/**
 * Lines of a paragraph, heading, or list item. Each run of consecutive non-block children becomes one line,
 * so `Parent <strong>bold</strong> tail` stays together when a nested list follows it. Block children recurse.
 */
function paragraphLines(element: HtmlElement): string[] {
  const lines: string[] = []
  let run: HtmlNode[] = []
  const flush = (): void => {
    const text = inlineNodes(run).trim()
    if (text.length > 0) lines.push(text)
    run = []
  }
  for (const child of element.children) {
    if (!isBlock(child)) {
      run.push(child)
      continue
    }
    flush()
    for (const line of blockLines([child])) lines.push(line)
  }
  flush()
  return lines
}

function isBlock(node: HtmlNode): boolean {
  return isElement(node) && (node.tag === 'table' || node.tag === 'ul' || node.tag === 'ol' || PARAGRAPH_TAGS.has(node.tag))
}

function tableText(table: HtmlElement): string {
  return tableRows(table).map(row => rowCells(row).map(cellText).join('\t')).join('\n')
}

function tableRows(element: HtmlElement): HtmlElement[] {
  const rows: HtmlElement[] = []
  for (const child of element.children) {
    if (!isElement(child)) continue
    if (child.tag === 'tr') rows.push(child)
    else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
      for (const row of tableRows(child)) rows.push(row)
    }
  }
  return rows
}

function rowCells(row: HtmlElement): HtmlElement[] {
  const cells: HtmlElement[] = []
  for (const child of row.children) {
    if (isElement(child) && (child.tag === 'td' || child.tag === 'th')) cells.push(child)
  }
  return cells
}

function cellText(cell: HtmlElement): string {
  const parts: string[] = []
  for (const child of cell.children) {
    const text = isElement(child) ? elementText(child) : child.text
    const flat = text.replace(/[\t\r\n]+/g, ' ').trim()
    if (flat.length > 0) parts.push(flat)
  }
  return parts.join(' ')
}

function elementText(element: HtmlElement): string {
  if (element.tag === 'img' || element.tag === 'br' || element.tag === 'input') return ''
  if (element.tag === 'table') return tableText(element)
  return inlineText(element)
}

function inlineText(element: HtmlElement): string {
  return inlineNodes(element.children)
}

function inlineNodes(nodes: readonly HtmlNode[]): string {
  let text = ''
  for (const child of nodes) {
    if (!isElement(child)) text += child.text
    else if (child.tag === 'br') text += '\n'
    else if (child.tag === 'img' || child.tag === 'input') continue
    else text += inlineText(child)
  }
  return text
}

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tag' in node
}

function parseHtml(html: string): HtmlNode[] {
  const root: HtmlElement = { tag: 'root', children: [] }
  const stack: HtmlElement[] = [root]
  let index = 0
  while (index < html.length) {
    const parent = stack[stack.length - 1]
    /* v8 ignore next -- the root never leaves the stack */
    if (parent === undefined) break
    if (html.charAt(index) !== '<') {
      const next = html.indexOf('<', index)
      const end = next === -1 ? html.length : next
      // The slice starts at a non-'<' character, and entities decode to at least one character.
      parent.children.push({ text: decodeHtml(html.slice(index, end)) })
      index = end
      continue
    }
    if (html.startsWith('<!--', index)) {
      const close = html.indexOf('-->', index + 4)
      index = close === -1 ? html.length : close + 3
      continue
    }
    if (html.startsWith('</', index)) {
      const end = html.indexOf('>', index + 2)
      if (end === -1) break
      if (stack.length > 1) stack.pop()
      index = end + 1
      continue
    }
    const tag = readOpenTag(html, index)
    if (tag === undefined) break
    index = tag.end
    if (tag.name.length === 0) continue
    const element: HtmlElement = { tag: tag.name, children: [] }
    parent.children.push(element)
    if (!tag.selfClosing) stack.push(element)
  }
  return root.children
}

interface OpenTag {
  name: string
  selfClosing: boolean
  end: number
}

function readOpenTag(html: string, start: number): OpenTag | undefined {
  let index = start + 1
  const marker = html.charAt(index)
  if (marker === '!' || marker === '?') {
    const end = html.indexOf('>', index)
    return end === -1 ? undefined : { name: '', selfClosing: true, end: end + 1 }
  }
  const nameStart = index
  while (index < html.length && isTagName(html.charAt(index))) index += 1
  const name = html.slice(nameStart, index).toLowerCase()
  if (name.length === 0) return undefined
  let selfClosing = VOID_TAGS.has(name)
  while (index < html.length) {
    const char = html.charAt(index)
    if (char === '>') {
      index += 1
      break
    }
    if (char === '/') {
      selfClosing = true
      index += 1
      continue
    }
    if (isSpace(char)) {
      index += 1
      continue
    }
    const before = index
    while (index < html.length) {
      const attr = html.charAt(index)
      if (isSpace(attr) || attr === '=' || attr === '>' || attr === '/') break
      index += 1
    }
    if (index === before) {
      index += 1
      continue
    }
    while (isSpace(html.charAt(index))) index += 1
    if (html.charAt(index) !== '=') continue
    index += 1
    while (isSpace(html.charAt(index))) index += 1
    const quote = html.charAt(index)
    if (quote === '"' || quote === "'") {
      const end = html.indexOf(quote, index + 1)
      if (end === -1) return undefined
      index = end + 1
      continue
    }
    while (index < html.length && !isSpace(html.charAt(index)) && html.charAt(index) !== '>') index += 1
  }
  return { name, selfClosing, end: index }
}

function isTagName(char: string): boolean {
  return (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')
}

function isSpace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f'
}

function decodeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, body: string) => {
    switch (body) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return "'"
      default: return decodeNumeric(body, match)
    }
  })
}

function decodeNumeric(body: string, raw: string): string {
  const hex = body.startsWith('#x')
  const value = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return raw
  return String.fromCodePoint(value)
}
