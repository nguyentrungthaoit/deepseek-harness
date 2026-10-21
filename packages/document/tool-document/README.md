---
description: "Model-facing read_document tool that extracts text and tables from docx, pdf, and xlsx files in a read-only sandbox child."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-document

English | [中文](README.zh.md)

## Summary

`dsh-tool-document` registers `read_document` so the agent can extract text and tables from docx, pdf, and xlsx files. `read` rejects those binary files, so the model uses this tool for the three extensions. Word paragraphs and tables become text lines, Excel sheets become tab-separated rows, and PDF text comes from the text layer with page markers. A PDF with no text layer returns a notice. Parsing runs in one read-only sandbox child per extraction; a cached result or an extraction already running for the same file serves later calls without another child.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package when the agent should read Word, PDF, and Excel text without going through `read`. `read` rejects those files as binary. The tool returns a line window, the same way `read` does, and a notice when a PDF has no text layer.

### When to choose it

Choose it for `.docx`, `.pdf`, and `.xlsx` text and tables. Leave `.doc`, `.xls`, `.ppt`, and `.pptx` out of this tool. Text files stay on `read`.

### Minimal configuration

Every cap has a default. A composition can omit `config` and still load. Set a field only to tighten or relax that cap. `limit: 0` fails at load.

```yaml
- name: '@deepseek-ai/dsh-tool-document'
  config:
    limit: 2000
    timeoutMs: 30000
```

| Field | Default | Meaning |
|---|---|---|
| `maxInputBytes` | `33554432` | Maximum file bytes. Larger files fail with `FS_TOO_LARGE` and are not truncated. |
| `maxArchiveEntries` | `2000` | Maximum ZIP central-directory entries for docx and xlsx, checked before the child starts. |
| `maxUncompressedBytes` | `33554432` | Maximum declared uncompressed ZIP size for docx and xlsx, checked before the child starts. |
| `maxPages` | `50` | Maximum PDF pages the child may read. |
| `maxExtractedChars` | `1000000` | Maximum characters the child may return. |
| `timeoutMs` | `30000` | Child deadline, counted from spawn. Waiting for a slot does not count. The parent kills the child and waits for exit. |
| `limit` | `2000` | Default and maximum lines in one result. |
| `maxLineLength` | `2000` | Maximum characters kept from one line. |
| `maxBytes` | `51200` | Maximum bytes of the selected lines. |
| `maxSheets` | `32` | Maximum Excel sheets the child may read. |
| `maxRowsPerSheet` | `5000` | Maximum non-empty rows the child may read from one sheet. A header row counts like any other row. |
| `maxConcurrent` | `2` | Maximum children running at once. |
| `maxQueued` | `8` | Maximum extractions waiting for a child slot. A call beyond that fails at once with `read_document is busy; retry after the running reads finish`. |
| `maxHeapMb` | `1024` | Child V8 old-space cap in MiB, passed as `--max-old-space-size`. An out-of-memory exit fails with `read_document ran out of memory; the file is too large to extract`. |

### What one call returns

The canonical value is `path`, `format` (`docx`, `pdf`, or `xlsx`), `offset`, `lines` of `{ number, text }`, `totalLines`, and `truncated`. `notice` is present when a PDF has no text layer or when an extraction cap stopped the child. `truncated` is true when the returned lines are not the full extracted text, and always when a cap stopped extraction.

A cap stop returns the text read so far and a notice sentence per cap, for example `Extraction stopped at maxPages (50 of 212 pages).` The four caps are `maxPages`, `maxSheets`, `maxRowsPerSheet`, and `maxExtractedChars`; a read can hit more than one.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin is named exports only: `name`, `inject`, `Config`, and `apply`. It registers `read_document` on `ctx.tools`. There is no client tool view; the generic card renders the call.

The parent resolves the path through `ctx.fs`, requires a regular file, and reads it with `readBytes`. Bytes over `maxInputBytes` fail with `FS_TOO_LARGE`. For docx and xlsx, the parent calls `assertZipLimits` on the central directory before spawn. Any other extension is a tool error.

One cache per plugin instance keeps up to 4 extractions or 8 MiB, keyed by the filesystem backend's stable target key (`FsTarget.targetKey`), `FsInfo.version`, and size. A call that continues with `offset` reuses the cached text and does not parse again. Every call still resolves and stats the path through its own session first, so a session cannot read through another session's entry. Concurrent calls with the same key share one child, which stops when every caller has aborted. A file whose version or size changes while it is read is not cached.

At most `maxConcurrent` children run at once, and `maxQueued` more calls wait; the slot is held from before the file read until the child exits.

The child receives the bytes on stdin and writes JSON text on stdout. Argv carries the format, the caps, and `--max-old-space-size`, never the file path. Spawn goes through `ctx.sandbox.confine` with mode `read-only`. `SANDBOX_UNAVAILABLE` fails the tool with `read_document cannot run because no sandbox is available on this host; do not retry`. There is no in-host parse fallback. Timeout, cancellation, and fiber disposal kill the child and await exit. The spawn passes no explicit environment, so the child gets the subprocess service's scrubbed parent environment: names matching `KEY`, `SECRET`, `TOKEN`, or `PASSWORD` and every `DSH_*` name are removed. The child exits with an error if a credential-shaped name still reaches it.

-----

<a id="further-exploration"></a>
## Further Exploration

- [document group](../README.md) — Office conversion and this tool.
- [Filesystem tools](../../fs/tool-fs/README.md) — `read` for text files.
- [Read Word, PDF, and Excel files](../../../docs/user/guide/read-document.md) — how to ask the model on the Web UI.

-----

<a id="model-experience"></a>
## Model Experience

### `read_document`

#### What the model sees

The model sees `read_document` with required `file_path` and optional `offset` and `limit`. The description tells it to use `read_document` for `.docx`, `.pdf`, and `.xlsx` because `read` rejects binary files. A successful result is line-numbered text plus a continuation or end footer. A PDF with no text layer adds `notice` and does not fail the call; a cap stop adds a `notice` and marks the result truncated. A system-prompt section tells the model to use `read_document`, not `read`, for these extensions and to continue with `offset`. Failures are tool errors, including `FS_TOO_LARGE`, `SANDBOX_UNAVAILABLE`, the busy error, the out-of-memory error, and a non-zero child exit.

#### Token effect

The tool definition is a fixed prefix cost while it stays visible. A normal result stays within `maxBytes` (50 KiB by default). A larger window is truncated and tells the model the next `offset`.

#### KV Cache effect

The definition stays prefix-stable while the caps and visibility are unchanged. Each call appends its arguments and result after that prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are the current tool, not a task list.

- **Read-only confinement can still read `/`.** That is the sandbox mode's accepted limit. The child is still confined, and a missing sandbox fails the tool instead of parsing in the host.
- **Windows cannot confine reads.** The child's reads are not restricted there.
- **Source launches fail under the Windows sandbox.** Run from source, the child loads `worker.ts` through tsx, and tsx cannot start `esbuild.exe` under the Windows restricted token (`spawn EPERM`) for a file it has not cached. Built launches run `lib/worker.js` and are not affected.
- **Docker confinement is unverified.** The company image has no bubblewrap and relies on Landlock, which depends on the host kernel and the Docker seccomp profile. Whether it works there has not been verified; where it fails, the tool fails closed with the no-sandbox error.
- **No OCR, page images, or legacy Office files.** `.doc`, `.xls`, `.ppt`, and `.pptx` are rejected. Scanned PDF pages with no text layer return `notice` and no page text.
- **Excel formulas are not recalculated.** The child returns the cached value stored in the file, or the formula string when no cached value exists.
- **The generic card is the only presentation.** This package does not register a client tool view.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
