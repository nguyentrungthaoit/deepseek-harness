/** Read-only git queries for the repository enclosing a Session working directory: recent commits and uncommitted change counts. */
import { parseNumstat } from './numstat.ts'
import type { GitRunner } from './git.ts'
import type { WorkspaceCommit, WorkspaceRepository } from './types.ts'

/** The empty tree object id; the comparison base of a repository without commits. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** Separates the fields of one `git log` record; no commit hash, number, or single-line subject contains it. */
const FIELD = '\x1f'

function parseCommits(output: string): WorkspaceCommit[] {
  const commits: WorkspaceCommit[] = []
  for (const record of output.split('\0')) {
    if (record === '') continue
    const [hash = '', parents = '', seconds = '0', subject = ''] = record.split(FIELD)
    commits.push({ hash, parents: parents === '' ? [] : parents.split(' '), time: Number(seconds) * 1_000, subject })
  }
  return commits
}

/**
 * Locate the repository work tree top-level enclosing a directory.
 * @param git - command runner.
 * @param cwd - absolute Session working directory.
 * @param signal - cancellation.
 * @returns the top-level directory, or null when the directory is outside a repository.
 */
export async function repositoryRoot(git: GitRunner, cwd: string, signal: AbortSignal): Promise<string | null> {
  const found = await git.run(['rev-parse', '--show-toplevel'], { cwd, signal })
  return found.exitCode === 0 ? found.stdout.trim() : null
}

/**
 * Read the latest commits and the uncommitted change counts of a repository.
 * @param git - command runner.
 * @param root - repository top-level directory.
 * @param limit - positive commit count to return at most.
 * @param signal - cancellation.
 * @returns branch, commits, and counts of files and lines that differ from HEAD.
 * @throws when a git read fails other than for the missing HEAD of a repository without commits.
 */
export async function readRepository(git: GitRunner, root: string, limit: number, signal: AbortSignal): Promise<WorkspaceRepository> {
  const run = async (args: string[]) => {
    const result = await git.run(args, { cwd: root, signal })
    if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`)
    return result.stdout
  }
  const born = (await git.run(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root, signal })).exitCode === 0
  const branch = (await git.run(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: root, signal })).stdout.trim()
  const commits = born
    ? parseCommits(await run(['log', '-z', `-n${limit}`, '--topo-order', `--format=%H${FIELD}%P${FIELD}%ct${FIELD}%s`, 'HEAD']))
    : []
  const tracked = parseNumstat(await run(['diff', '--numstat', '-z', '--no-renames', born ? 'HEAD' : EMPTY_TREE]))
  const untracked = (await run(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(path => path !== '')
  return {
    branch: branch === '' ? null : branch,
    commits,
    files: tracked.length + untracked.length,
    added: tracked.reduce((sum, entry) => sum + entry.added, 0),
    deleted: tracked.reduce((sum, entry) => sum + entry.deleted, 0),
  }
}
