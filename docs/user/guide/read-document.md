# Read Word, PDF, and Excel files

English | [中文](read-document.zh.md)

[Tiếng Việt](read-document.vi.md)

## Summary

Ask the model to read text and tables from a Word, PDF, or Excel file in the workspace, or from a file you attached in the composer. The model uses `read_document`. The text tool `read` rejects those files as binary.

## Table of Contents

- [Ask the model to read a file](#ask-the-model)
- [Which files work](#which-files)
- [Check that the tool is available](#check-the-tool)
- [Added the row with the old guide](#old-guide-row)
- [Limits and failures](#limits-and-failures)
- [Further Exploration](#further-exploration)

<a id="ask-the-model"></a>
## Ask the model to read a file

Put the file in the selected workspace, or attach it in the composer. An attachment is stored as-is and the model receives a read-only path. Ask for the contents in ordinary language.

For example, ask: "Read report.docx and summarize the table in the first section."

The model calls `read_document` with that path. A finished call shows a generic tool row named `read_document`. The result is line-numbered text. Word paragraphs and tables become lines, with table cells separated by tabs. Each Excel sheet starts with a heading line, then tab-separated rows. PDF text includes a marker for each page that has text.

A long file comes back as a window. Ask the model to continue, and it calls `read_document` again with a later `offset`.

<a id="which-files"></a>
## Which files work

These extensions work:

- `.docx` — paragraphs and tables.
- `.pdf` — the text layer. A scanned page with no text returns a notice and no page text.
- `.xlsx` — sheet names and cell text. A formula cell returns the value stored in the file, or the formula text when the file has no stored value.

These extensions do not work: `.doc`, `.xls`, `.ppt`, `.pptx`, and ordinary text files. Text files stay on `read`.

<a id="check-the-tool"></a>
## Check that the tool is available

The shipped Web presets `standard`, `ptc`, and `cordis` include `read_document`. `minimal` does not. In Docker, the shipped presets include it from image tag `0.2.1-alpha.6`; set `DSH_IMAGE_TAG` in `docker/compose.env`. Images `0.2.1-alpha.4` and `0.2.1-alpha.5` contain the package, but their shipped presets do not include it; only the manual row from the [old guide](#old-guide-row) turns it on there. Images before `0.2.1-alpha.4` do not contain the package, so no configuration adds the tool.

To check, open **Settings → Agent presets**, choose the preset the session uses, and select **View configuration**. Search for `tool-document`. Desktop and SDK profiles do not include it.

<a id="old-guide-row"></a>
## Added the row with the old guide

An earlier version of this guide had you add a `tool-document` block to `/data/dsh/profiles/web/cordis.patch.yml`. That block replaces the preset's whole plugin list, so later changes to the shipped preset never reach you. The tool keeps working. Choose one:

- Keep the block. Nothing changes, but you do not receive future preset changes.
- Remove exactly the block you added, then restart the container to use the shipped preset. Any other edit you made inside that same block is lost with it. Do this only on image `0.2.1-alpha.6` or later; on `0.2.1-alpha.4` and `0.2.1-alpha.5` the shipped preset does not include the tool, so removing the block removes it.

<a id="limits-and-failures"></a>
## Limits and failures

A file larger than 32 MiB fails and is not cut short. A Word or Excel package with more than 2000 ZIP entries, or more than 32 MiB of declared uncompressed size, fails before parsing. One call returns at most 2000 lines and 50 KiB of those lines. A call that runs longer than 30 seconds is stopped; the time spent waiting for a free reader does not count.

Extraction also stops at a cap: 50 PDF pages, 32 Excel sheets, 5000 non-empty rows on a sheet (a header row counts), or 1,000,000 characters. The result is marked truncated and carries a notice, for example `Extraction stopped at maxPages (50 of 212 pages).` The text read so far is returned.

At most 2 files are read at once, and 8 more may wait. A call beyond that fails with `read_document is busy; retry after the running reads finish`. Retry after the running reads finish. A file that needs too much memory fails with `read_document ran out of memory; the file is too large to extract`.

A host with no sandbox fails the call with `read_document cannot run because no sandbox is available on this host; do not retry`. Parsing does not continue inside the Web server process. A corrupt or encrypted file fails the call. A PDF with no text layer succeeds and tells the model there is no text to read.

<a id="further-exploration"></a>
## Further Exploration

- [Package contract](../../../packages/document/tool-document/README.md) — configuration fields and the model-facing result.
- [Use the Web UI](./index.md) — start the server and choose a workspace.
