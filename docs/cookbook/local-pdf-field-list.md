# Local PDF field list

English | [中文](local-pdf-field-list.zh.md)

[Tiếng Việt](local-pdf-field-list.vi.md)

A local model plans one extraction and returns `{prompt, fields}`. A program outside the session compiles `fields` into a Vertex `responseSchema` and calls `gemini-3.1-pro-preview`. The session does not call Vertex.

The four files below own the field contract. This page owns how a session loads them and how that work stays inside a local context window.

## Files

| File | Catalog name | What it owns |
|---|---|---|
| [field-list](../../workspace/local-extract/rules/field-list.md) | `field-list` | The JSON object, types, paths, and forbidden keys |
| [default-envelope](../../workspace/local-extract/rules/default-envelope.md) | `default-envelope` | `responseCode`, `responseDesc`, `ocrRate`, and the `data.response.` prefix |
| [vertex-schema-limits](../../workspace/local-extract/rules/vertex-schema-limits.md) | `vertex-schema-limits` | How to keep the compiled schema small enough to submit |
| [plan-from-pdf](../../workspace/local-extract/skills/plan-from-pdf.md) | `plan-from-pdf` | Which pages to read, which fields to keep, and the single submit |

## Register the two roots

Discovery accepts a flat `<name>.md` file at the top of a scanned root. It skips a nested `SKILL.md`. `workspace/local-extract/rules` and `workspace/local-extract/skills` are separate from the default `.dsh/skills` and `.agents/skills` roots.

Set `customSkillDirs` on the `@deepseek-ai/dsh-skill-filesystem` plugin. The provider passes each entry to `path.resolve`, so use an absolute path. The field is documented in the [filesystem skill README](../../packages/skill/skill-filesystem/README.md).

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - <repo>/workspace/local-extract/rules
      - <repo>/workspace/local-extract/skills
```

Replace `<repo>` with the absolute path of this repository. A catalog entry appears when the frontmatter `name` is kebab-case and `description` is present. These four files use the file stem as that name.

## What the model receives

When model-invocable skills exist and the `skill` tool is visible, the session lists each `name` and `description` before the first request. The model loads a listed skill with the `skill` tool and receives the current file body. A user message injects one skill with `/plan-from-pdf`.

`catalogDescriptionMaxLength` on `@deepseek-ai/dsh-tool-skill` defaults to 500. These four descriptions fit that cap. The list stays short, and each body loads when the model asks for that skill.

## One local turn

Extract the PDF text before the session and send that text. A text layer of 10 to 30 pages fits a configured 128k window. Page images spend that window on pixels.

The user message contains the business rule, the page text, and the instruction to load `plan-from-pdf` and follow it. The four files stay on disk. The model loads `plan-from-pdf`, then `field-list`, `default-envelope`, and `vertex-schema-limits`, submits one JSON object, and stops.

The local model has no Vertex call and no status code to read. Regex, string length, and numeric bounds stay out of `fields`. The external program checks them after generation.

## After the JSON

The external program builds `responseSchema` from `fields` and calls `gemini-3.1-pro-preview` with the PDF and `prompt`. `prompt` states the task and the writing conventions. The field list stays in the schema.

When Vertex returns `Request contains an invalid argument.`, the external program splits the document fields by the first path segment and merges the returned objects. That status stays outside the local session.

## When a name is missing

A missing catalog name means the file is not a direct child of a configured root, or the frontmatter `name` or `description` was rejected. Correct the path or the frontmatter. The provider watches the roots, so a frontmatter edit reaches the next catalog without a process restart.
