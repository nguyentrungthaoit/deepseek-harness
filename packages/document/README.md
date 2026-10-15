---
description: "Package map for Host Office conversion and document text extraction."
kind: "package-group"
---

# document/ — Office documents

English | [中文](README.zh.md)

## Summary

Convert authorized Office files to reusable PDFs on the Host, and extract text from docx, pdf, and xlsx with `read_document`. The shared conversion service uses LibreOffice kit. Targets with a declared native engine use it; other targets use Node WASM.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package owns its configuration and lifetime rules; the subsystem reference describes their shared conversion operation.

| Package | Role | ctx key |
|---|---|---|
| [office-to-pdf](office-to-pdf/README.md) | Authorized Office bytes to complete PDFs with bounded queues and caching | `ctx.officeToPdf` |
| [tool-document](tool-document/README.md) | `read_document` text and tables from docx, pdf, and xlsx | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

Consumers own source authorization and presentation.

- [Document conversion](../../docs/subsystems/office-to-pdf.md) — shared operation and generated service reference.
- [Independent kit ownership](../../.agents/notes/implemented/architecture/2026-09-14-independent-libreoffice-kit.md) — engine distribution and application integration.
- [Workspace Files](../api/workspace-files/README.md) — authorized bounded source reads.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
