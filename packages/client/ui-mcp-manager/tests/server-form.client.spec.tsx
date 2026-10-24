// @vitest-environment jsdom
/** Server form and key/value editor: create, edit with stored secrets and expressions, and state. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { McpServerView } from '@deepseek-ai/dsh-mcp-manager/types'
import { ServerForm } from '../src/client/ServerForm.tsx'
import { t, view } from './fixtures.client.ts'

afterEach(cleanup)

function mount(props: { view?: McpServerView; saving?: boolean; error?: never } = {}) {
  const onSubmit = vi.fn(), onCancel = vi.fn()
  const utils = render(<ServerForm {...props} saving={props.saving ?? false} t={t} onSubmit={onSubmit} onCancel={onCancel} />)
  const save = (): HTMLButtonElement => utils.getByText('Save') as HTMLButtonElement
  const type = (label: string, value: string): void => { fireEvent.change(utils.getByLabelText(label), { target: { value } }) }
  return { ...utils, onSubmit, onCancel, save, type }
}

describe('ServerForm create', () => {
  it('keeps Save disabled until the name and command are valid, then submits', () => {
    const r = mount()
    expect(r.getByText('Add MCP server')).toBeTruthy()
    expect(r.save().disabled).toBe(true)
    r.type('Server name', 'bad name!')
    r.type('Command', 'node')
    expect(r.save().disabled).toBe(true)
    fireEvent.submit(r.container.querySelector('form')!)
    expect(r.onSubmit).not.toHaveBeenCalled()
    r.type('Server name', 'files')
    expect(r.save().disabled).toBe(false)
    r.type('Arguments, one per line', 'a\nb')
    r.type('Working directory', '/w')
    fireEvent.click(r.save())
    expect(r.onSubmit).toHaveBeenCalledWith({
      serverName: 'files', transport: 'stdio', command: 'node', args: ['a', 'b'], cwd: '/w',
    })
  })

  it('clears secrets when the transport switches, and requires a URL for HTTP', () => {
    const r = mount()
    fireEvent.click(r.getByText('Add entry'))
    fireEvent.change(r.getByLabelText('Key'), { target: { value: 'A' } })
    fireEvent.change(r.getByLabelText('Value'), { target: { value: 'v' } })
    expect(r.getByText('Environment variables')).toBeTruthy()
    fireEvent.click(r.getByText('Streamable HTTP'))
    expect(r.getByText('Headers')).toBeTruthy()
    expect(r.queryByLabelText('Key')).toBeNull()
    r.type('Server name', 'web')
    expect(r.save().disabled).toBe(true)
    r.type('URL', 'https://x/mcp')
    fireEvent.click(r.getByText('Add entry'))
    fireEvent.change(r.getByLabelText('Key'), { target: { value: 'Authorization' } })
    fireEvent.change(r.getByLabelText('Value'), { target: { value: 'Bearer z' } })
    fireEvent.click(r.save())
    expect(r.onSubmit).toHaveBeenCalledWith({
      serverName: 'web', transport: 'streamable-http', url: 'https://x/mcp',
      headers: { Authorization: { value: 'Bearer z' } },
    })
  })

  it('removes a new entry, sets advanced options, and cancels', () => {
    const r = mount()
    fireEvent.click(r.getByText('Add entry'))
    fireEvent.click(r.getByText('Remove entry'))
    expect(r.queryByLabelText('Key')).toBeNull()
    r.type('Server name', 'files')
    r.type('Command', 'node')
    r.type('Tool call timeout (ms)', '5000')
    fireEvent.click(r.getByRole('switch', { name: 'Fail on startup error' }))
    fireEvent.click(r.getByRole('switch', { name: 'Reconnect automatically after a disconnect' }))
    fireEvent.click(r.save())
    expect(r.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      toolCallTimeoutMs: 5000, failOnStartupError: true, reconnect: { enabled: false },
    }))
    fireEvent.click(r.getByText('Cancel'))
    expect(r.onCancel).toHaveBeenCalled()
  })

  it('disables the form while saving and shows an error', () => {
    const r = mount({ saving: true, error: 'error.nameConflict' as never })
    expect(r.save().disabled).toBe(true)
    expect(r.getByRole('alert').textContent).toBe('An MCP server with this name already exists')
    expect(r.getByLabelText('Server name').closest<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true)
  })
})

describe('ServerForm edit', () => {
  // A fresh literal would reject `env`; the variable lets a stray value reach the form.
  const config = {
    serverName: 'files', transport: 'stdio' as const, command: { expression: 'cmd()' }, args: ['x'], env: { TOKEN: 'ignored' },
  }
  const stored = view({
    config,
    secrets: [{ path: ['env', 'TOKEN'], set: true }, { path: ['env', 'GONE'], set: true }],
  })

  it('keeps a blank stored secret, sends typed values, and omits removed entries', () => {
    const r = mount({ view: stored })
    expect(r.getByText('Edit MCP server')).toBeTruthy()
    expect(r.save().disabled).toBe(false)
    fireEvent.click(r.save())
    expect(r.onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({
      command: { keep: true }, env: { TOKEN: { keep: true }, GONE: { keep: true } },
    }))
    const secret = r.getByLabelText('TOKEN') as HTMLInputElement
    expect(secret.value).toBe('')
    fireEvent.change(secret, { target: { value: 'new' } })
    fireEvent.click(r.getAllByText('Remove entry')[1]!)
    fireEvent.click(r.save())
    expect(r.onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ env: { TOKEN: { value: 'new' } } }))
    expect(r.container.textContent).not.toContain('ignored')
  })

  it('omits env entirely once every entry is removed', () => {
    const r = mount({ view: stored })
    fireEvent.click(r.getAllByText('Remove entry')[0]!)
    fireEvent.click(r.getAllByText('Remove entry')[0]!)
    fireEvent.click(r.save())
    expect(r.onSubmit.mock.calls[0]![0]).not.toHaveProperty('env')
  })

  it('shows an expression source and turns it into an input on Replace', () => {
    const r = mount({ view: stored })
    expect(r.getByText('Computed by an expression: cmd()')).toBeTruthy()
    fireEvent.click(r.getByText('Replace'))
    const input = r.getByLabelText('Command') as HTMLInputElement
    expect(input.value).toBe('')
    expect(r.save().disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'node' } })
    expect(r.save().disabled).toBe(false)
    fireEvent.click(r.save())
    expect(r.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ command: 'node' }))
  })
})
