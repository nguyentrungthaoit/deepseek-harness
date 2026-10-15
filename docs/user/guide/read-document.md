# Read Word, PDF, and Excel files

English | [中文](read-document.zh.md)

[Tiếng Việt](read-document.vi.md)

## Summary

Ask the model to read text and tables from a Word, PDF, or Excel file in the workspace, or from a file you attached in the composer. The model uses `read_document`. The text tool `read` rejects those files as binary.

## Table of Contents

- [Ask the model to read a file](#ask-the-model)
- [Which files work](#which-files)
- [Mount the tool](#mount-the-tool)
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

<a id="mount-the-tool"></a>
## Mount the tool

The shipped Web presets do not include this tool. Add one row to the preset the session uses. `standard`, `ptc`, and `cordis` are the presets that already include file tools. `minimal` does not.

```yaml
- id: tool-document
  name: '@deepseek-ai/dsh-tool-document'
```

Place the row next to `tool-fs`. The package supplies every limit, so `config` is optional. Desktop and SDK profiles do not include this row.

<a id="limits-and-failures"></a>
## Limits and failures

A file larger than 32 MiB fails and is not cut short. A Word or Excel package with more than 2000 ZIP entries, or more than 32 MiB of declared uncompressed size, fails before parsing. A PDF read stops after 50 pages. One call returns at most 2000 lines and 50 KiB of those lines. Excel stops after 32 sheets and 5000 data rows on a sheet. A call that runs longer than 30 seconds is stopped.

A missing sandbox fails the call. Parsing does not continue inside the Web server process. A corrupt or encrypted file fails the call. A PDF with no text layer succeeds and tells the model there is no text to read.

<a id="further-exploration"></a>
## Further Exploration

- [Package contract](../../../packages/document/tool-document/README.md) — configuration fields and the model-facing result.
- [Use the Web UI](./index.md) — start the server and choose a workspace.
