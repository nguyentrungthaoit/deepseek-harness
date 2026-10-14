# Local PDF field list

English | [中文](local-pdf-field-list.zh.md)

[Tiếng Việt](local-pdf-field-list.vi.md)

One turn reads a PDF of 10 to 30 pages together with the rule files and the skill. The local model then returns `{prompt, fields}`. A program outside the session compiles `fields` into a Vertex `responseSchema` and calls `gemini-3.1-pro-preview`. The session does not call Vertex.

## 1. Load the rules and the skill

The local model reads these four files before it chooses a field. [plan-from-pdf](../../workspace/local-extract/skills/plan-from-pdf.md) is the procedure. It requires [field-list](../../workspace/local-extract/rules/field-list.md), [default-envelope](../../workspace/local-extract/rules/default-envelope.md), and [vertex-schema-limits](../../workspace/local-extract/rules/vertex-schema-limits.md).

Point `customSkillDirs` on `@deepseek-ai/dsh-skill-filesystem` at the two directories below, using absolute paths. The field is documented in the [filesystem skill README](../../packages/skill/skill-filesystem/README.md).

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - <repo>/workspace/local-extract/rules
      - <repo>/workspace/local-extract/skills
```

Replace `<repo>` with the absolute path of this repository. A catalog name appears when that file is a direct child of one of those directories and its frontmatter `name` and `description` are valid. The user message injects the procedure with `/plan-from-pdf`.

## 2. Send the PDF text and the business rule

Extract the text layer before the turn and send that text with the business rule. A text layer of 10 to 30 pages fits a configured 128k window. Page images spend that window on pixels.

The business rule names the fields inside `data.response`. The PDF says whether this file contains them and where they sit. The three envelope fields in [default-envelope](../../workspace/local-extract/rules/default-envelope.md) are fixed and are not read from the PDF.

## 3. Read the pages the skill names

When the session has `list_pages` and `read_pages`, read the first page, the pages that contain tables, and the pages whose headings match the business rule. Leave a page unread when its text is already in the context.

When those tools are absent, use the PDF text already in the message. Call only tool names that exist in the session. Leave Vertex uncalled.

## 4. Submit one JSON object

The model checks the draft against the three rules, then submits once. The object is `{prompt, fields}` from [field-list](../../workspace/local-extract/rules/field-list.md). The message contains that object alone.

`fields` starts with `responseCode`, `responseDesc`, and `ocrRate`. Every document field path starts with `data.response.`. `prompt` states the task and the writing conventions. The field list stays in `fields`.

## 5. Compile the schema outside the session

The external program builds `responseSchema` from `fields` and calls `gemini-3.1-pro-preview` with the full PDF and `prompt`. Regex, string length, and numeric bounds stay out of `fields`. That program checks them after generation.

## 6. Split after an opaque rejection

When Vertex returns `Request contains an invalid argument.`, the external program splits the document fields by the first path segment and merges the returned objects. That status stays outside the local session.
