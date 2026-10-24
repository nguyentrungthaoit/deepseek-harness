---
description: "Save active profile configuration and apply it through Loader."
kind: "package-reference"
---

# @deepseek-ai/dsh-config-editor

English | [中文](README.zh.md)

## Summary

Save plugin configuration in the active profile’s patch and apply it immediately. Writes validate the complete candidate before touching disk and serialize with profile changes and HMR. Invalid values and higher-layer overrides leave the file unchanged.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this service in a profile application with Loader and `profileContext`.

```yaml
- id: config-editor
  name: '@deepseek-ai/dsh-config-editor'
```

| Field | Default | Meaning |
|---|---|---|
| `lockWaitMs` | `120000` | Maximum time in milliseconds a save waits for another writer’s profile lock. |

A settings save can therefore wait up to `lockWaitMs` while [Plugin Manager](../plugin-manager/README.md) holds the lock, for example during a package install; a save that cannot acquire the lock in that time fails.

Use [settings](../../settings/settings/README.md) for forms restricted to live fields. Callers that edit complete configuration can use `ctx.configEditor.edit()`; ordinary fields retain Loader’s normal lifecycle. `ctx.configEditor.rewrite(change)` rewrites the whole patch document: `change` receives the parsed, comment-preserving document and its top-level items, may insert or remove rows, and returns the ids that must be active afterwards. Maps with a single `__jsExpr` key are written as `!!js` expressions. A row that `change` inserts has no Fiber to validate against, so only reconciliation validates it; when a returned id does not activate, the file and composition are restored and the error is rethrown. `rewrite` returns diagnostics for entries that remain inactive.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [editor](src/index.ts) reconciles external changes before deriving a candidate, holds the profile file lock (`<profile>/package.json`) and then the HMR queue, the order Plugin Manager takes them in, for both `edit()` and `rewrite()`, and atomically replaces its config override. It preserves YAML comments and `!!js` expressions outside replaced values. A failed reconciliation restores the prior document and reloads the prior patches.

Configuration reads share one composition for entries without profile config overrides. Overridden entries are composed separately with only their own override removed; profile inserts and other entries' overrides remain effective. Returned configs are detached, and compositions are not cached between reads.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Profile loading](../app-boot/README.md) — patch composition.
- [HMR](../hmr/README.md) — reload coordination.
- [Settings](../../settings/settings/README.md) — schema-derived forms.

<a id="model-experience"></a>
## Model Experience

Indirectly, through configuration values consumed by model-facing plugins.

#### KV Cache effect

Consumers that change request prefixes determine cache effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Edits target the active profile patch. Home patches and command-line overlays are read for precedence but are not write targets.
- A complete config override preserves ordinary fields but pins their current raw values at the profile layer.
- Only uniquely addressed entries owned by the profile’s root Include are editable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
