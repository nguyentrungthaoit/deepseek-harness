/** Minimal line-delimited JSON-RPC MCP server: one `echo` tool. */
import { createInterface } from 'node:readline'

process.stdin.once('end', () => process.exit(0))

createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  const reply = body => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, ...body })}\n`)
  switch (request.method) {
    case 'initialize':
      reply({ result: {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1.0.0' },
      } })
      return
    case 'tools/list':
      reply({ result: { tools: [{ name: 'echo', title: 'Echo', description: 'Echoes text.', inputSchema: { type: 'object' } }] } })
      return
    default:
      reply({ error: { code: -32601, message: `unsupported ${request.method}` } })
  }
})
