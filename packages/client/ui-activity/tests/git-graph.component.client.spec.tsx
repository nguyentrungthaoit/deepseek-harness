// @vitest-environment jsdom
/** The git graph renders the Host answer, hides outside a repository, and re-reads when its key changes. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { WorkspaceRepository } from '@deepseek-ai/dsh-workspace-changes/types'
import { GitGraph } from '../src/client/GitGraph.tsx'
import { en } from '../src/client/locales.ts'

beforeEach(() => { vi.useFakeTimers({ now: 10_000_000 }) })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = makeTranslate(en, common)

const hash = (letter: string) => letter.repeat(40)

const repository: WorkspaceRepository = {
  branch: 'main',
  files: 3,
  added: 12,
  deleted: 4,
  commits: [
    { hash: hash('c'), parents: [hash('b'), hash('s')], time: 10_000_000 - 30_000, subject: 'Merge side' },
    { hash: hash('b'), parents: [hash('a')], time: 10_000_000 - 3 * 60_000, subject: 'Main work' },
    { hash: hash('s'), parents: [hash('a')], time: 10_000_000 - 2 * 3_600_000, subject: 'Side work' },
    { hash: hash('a'), parents: [], time: 10_000_000 - 3 * 86_400_000, subject: 'Initial' },
  ],
}

async function mount(load: (signal: AbortSignal) => Promise<WorkspaceRepository | null>, key = 'k1') {
  const view = render(<GitGraph load={load} refreshKey={key} t={t} />)
  await act(async () => { await Promise.resolve() })
  return view
}

describe('GitGraph', () => {
  it('lists the commits with short hashes, subjects, and ages, above the uncommitted change count', async () => {
    const view = await mount(() => Promise.resolve(repository))
    const section = view.getByRole('region', { name: en['git.label'] })
    expect(section.querySelector('h3')!.textContent).toBe('Git')
    expect(view.getByText('main')).toBeTruthy()
    expect(view.getByText('3 files changed, +12 −4')).toBeTruthy()
    const rows = [...section.querySelectorAll('li')].map(row => [...row.querySelectorAll('span')].map(span => span.textContent))
    expect(rows).toEqual([
      ['ccccccc', 'Merge side', 'just now'],
      ['bbbbbbb', 'Main work', '3m ago'],
      ['sssssss', 'Side work', '2h ago'],
      ['aaaaaaa', 'Initial', '3d ago'],
    ])
    expect(view.getByText('Merge side').getAttribute('title')).toBe('Merge side')
    // The merge draws its dot plus a line to each parent lane; the lanes span two columns.
    const merge = section.querySelector('li svg')!
    expect(merge.getAttribute('width')).toBe('24')
    expect(merge.querySelectorAll('circle')).toHaveLength(1)
    expect(merge.querySelectorAll('line')).toHaveLength(2)
  })

  it('words a clean tree, a single changed file, a detached HEAD, and an empty repository', async () => {
    const clean = await mount(() => Promise.resolve({ ...repository, files: 0, added: 0, deleted: 0, branch: null }))
    expect(clean.getByText(en['git.clean'])).toBeTruthy()
    expect(clean.getByText(en['git.detached'])).toBeTruthy()
    cleanup()
    const one = await mount(() => Promise.resolve({ ...repository, files: 1, added: 1, deleted: 0 }))
    expect(one.getByText('1 file changed, +1 −0')).toBeTruthy()
    cleanup()
    const empty = await mount(() => Promise.resolve({ branch: null, commits: [], files: 2, added: 0, deleted: 0 }))
    expect(empty.getByText(en['git.noCommits'])).toBeTruthy()
    expect(empty.queryAllByRole('listitem')).toEqual([])
  })

  it('renders nothing outside a repository or before the first answer', async () => {
    const outside = await mount(() => Promise.resolve(null))
    expect(outside.container.innerHTML).toBe('')
    cleanup()
    const pending = await mount(() => new Promise<WorkspaceRepository | null>(() => {}))
    expect(pending.container.innerHTML).toBe('')
  })

  it('re-reads when the key changes, keeps the last answer when a read fails, and drops an answer that lost its race', async () => {
    const load = vi.fn((_signal: AbortSignal) => Promise.resolve<WorkspaceRepository | null>(repository))
    const view = await mount(load, 'a')
    expect(load).toHaveBeenCalledTimes(1)
    load.mockImplementationOnce(() => Promise.reject(new Error('git down')))
    view.rerender(<GitGraph load={load} refreshKey="b" t={t} />)
    await act(async () => { await Promise.resolve() })
    expect(view.getByText('Merge side')).toBeTruthy()

    let finishSlow: (value: WorkspaceRepository | null) => void = () => {}
    load.mockImplementationOnce(() => new Promise((resolve) => { finishSlow = resolve }))
    view.rerender(<GitGraph load={load} refreshKey="c" t={t} />)
    load.mockImplementationOnce(() => Promise.resolve({ ...repository, branch: 'newer' }))
    view.rerender(<GitGraph load={load} refreshKey="d" t={t} />)
    await act(async () => { await Promise.resolve() })
    expect(view.getByText('newer')).toBeTruthy()
    const firstSignal = load.mock.calls[2]![0]
    expect(firstSignal.aborted).toBe(true)
    await act(async () => { finishSlow({ ...repository, branch: 'stale' }); await Promise.resolve() })
    expect(view.queryByText('stale')).toBeNull()
    expect(view.getByText('newer')).toBeTruthy()
  })
})
