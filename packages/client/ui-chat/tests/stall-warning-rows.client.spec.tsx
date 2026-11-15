// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ModelStallWarningRow, ToolStallWarningRow, type StallWarningRowProps,
} from '../src/client/settings/StallWarningRows.tsx'
import type { StallWarningThresholds } from '../src/client/stall-warning.ts'
import { en, zh } from '../src/client/locale.ts'

afterEach(cleanup)

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

function mount(Row: typeof ModelStallWarningRow, dictionary: typeof en | typeof zh = en) {
  const source = createSnapshotStore<StallWarningThresholds>({ model: 120, tool: 300 })
  const setModelStallWarning = vi.fn((model: StallWarningThresholds['model']) => { source.set({ ...source.getSnapshot(), model }) })
  const setToolStallWarning = vi.fn((tool: StallWarningThresholds['tool']) => { source.set({ ...source.getSnapshot(), tool }) })
  const props: StallWarningRowProps = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: bindSnapshotSelector(createSnapshotStore<SessionListState>({
      ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
    })),
    useSessionStatus: bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map())),
    useWorkspaces: bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
      items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    })),
    useSessionRetainInfo: () => undefined,
    useResource,
    useStallWarning: bindSnapshotSelector(source),
    setModelStallWarning,
    setToolStallWarning,
    t: makeTranslate(dictionary),
  }
  render(<Row {...props} />)
  return { setModelStallWarning, setToolStallWarning }
}

describe('stall warning rows', () => {
  it('offers the model thresholds and publishes the chosen number of seconds', () => {
    const b = mount(ModelStallWarningRow)
    expect(screen.getByText('Model stall warning')).toBeDefined()
    expect(screen.getByText('Warn when the model sends nothing for this long')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /2 min/ }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent))
      .toEqual(['Off', '1 min', '2 min', '5 min', '10 min'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Off' }))
    expect(b.setModelStallWarning).toHaveBeenCalledWith(0)
    expect(screen.getByRole('button', { name: /Off/ })).toBeDefined()
    expect(b.setToolStallWarning).not.toHaveBeenCalled()
  })

  it('offers the Tool thresholds and publishes the chosen number of seconds', () => {
    const b = mount(ToolStallWarningRow, zh)
    expect(screen.getByText('工具长时间运行提醒')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /5 分钟/ }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent))
      .toEqual(['关闭', '2 分钟', '5 分钟', '10 分钟', '30 分钟'])
    fireEvent.click(screen.getByRole('menuitem', { name: '30 分钟' }))
    expect(b.setToolStallWarning).toHaveBeenCalledWith(1800)
    expect(screen.getByRole('button', { name: /30 分钟/ })).toBeDefined()
  })
})
