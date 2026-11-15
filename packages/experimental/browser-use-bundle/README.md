---
description: "Enable experimental per-Session Chromium browser tools from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-browser-use-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle composes the browser-use service with the [Playwright MCP provider](../browser-use-playwright-mcp/README.md), so each live Session gets its own headless Chromium. Shipped profiles leave it disabled.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open Plugins in the Web sidebar and enable Browser tools. New and resumed Sessions then carry the Playwright MCP tools; Sessions already active keep their current tool set. The provider launches a headless, isolated Chromium. When `DSH_BROWSER_CHROMIUM` names an executable it launches that one, which the Docker image sets to a launcher adding `--no-sandbox`; otherwise Playwright discovers its own installation, which must already exist on the machine.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The static `cordis.patch.yml` adds the `browser-use` service row and the Playwright MCP provider row in launch mode. Optional-bundle installation makes both packages resolvable from the installation without selecting them in default profiles, which keeps the experimental provider out of the shipped presets.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Playwright MCP provider](../browser-use-playwright-mcp/README.md) · [browser-use service](../../browser-use/browser-use/README.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [Playwright MCP provider](../browser-use-playwright-mcp/README.md), which owns the `mcp__playwright-mcp__` browser tools and their results.

#### KV Cache effect

This bundle contributes no request-prefix content. The provider owns model-visible tools and results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The bundle installs no browser. Outside the Docker image, Chromium must already be installed where Playwright looks for it, or `DSH_BROWSER_CHROMIUM` must name an executable.
- Attach mode, which reuses an existing browser with its tabs and logins, is not exposed; the bundle always launches a fresh isolated browser.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
