---
description: "Right Sidebar Activity tab for the Web client: live meters and a flame graph of the Session's latest Turn, a workspace git graph, and a model speed history."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-activity

English | [中文](README.zh.md)

## Summary

This package adds an **Activity** page to the right Sidebar. Compact meters show the latest Turn's context use, cache-hit share, running Tools, subagents, and jobs, and elapsed time. A git graph lists the workspace's latest commits and counts its uncommitted changes. A model speed section charts median output speed and time to first token by hour of day. A flame graph draws one bar per model step and Tool call on a shared time axis, with nested calls indented under their parent.

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

Mount the browser row in the Web composition. The row needs the `slots`, `locale`, `sidebarRightTabs`, `uiConversation`, and `jobs` services, and registers into the `sidebar.right.pane.tab` and `sidebar.right.pane.tab.title` seats of [`ui-sidebar-right`](../ui-sidebar-right/README.md). The Host half needs `connection` and `workspaceChanges` and serves the git graph's read-only route `/api/activity.git`.

| Field | Default | Meaning |
|---|---|---|
| `gitCommits` | `8` | Commits the git graph lists; the Host clamps the request to the `maxCommits` of [`workspace-changes`](../../deliverables/workspace-changes/README.md) |
| `speedSamples` | `2000` | Most model-step speed samples kept in this browser; the oldest are dropped first |
| `speedMinBucketSamples` | `3` | Samples an hour of the day needs before the `activitySpeed` service prefers it over the model's all-day medians |
| `speedRecentRuns` | `30` | Latest runs the speed sparkline draws |

### What to expect

Open the right Sidebar and pick **Activity** on its guide page. The page follows the Session it is open in.

A meter appears only when its source has reported a value. The context meter needs both a provider-reported prompt size and a route capacity. The cache meter needs at least one finished step of the Turn that reported cache reads. The running counts and the elapsed time appear once the Session has a Turn. The page shows no cost.

In the flame graph, model steps are colored by output: waiting for the first token, thinking (reasoning only), or writing. The lighter lead-in of a step bar is the time to first token. Tool calls are green, subagent delegations orange, and failed calls red. Hovering or focusing a bar shows its name, kind, and duration. Running bars pulse unless the system asks for reduced motion.

The **Git** section appears once the Host reports a repository for the Session's working directory and stays hidden otherwise. It shows the branch, a line such as "3 files changed, +12 −4" for the uncommitted work tree ("Working tree clean" when nothing differs), and the latest commits as dots on lanes with their short hash, subject, and age; a merge draws a line into each parent's lane. It reads again when a Turn ends or a Tool call settles, never on a timer.

The **Model speed** section names the model of the Session's latest finished step. It shows the median output speed (tok/s) and time to first token, a 24-bar chart of each by local hour of day with the current hour highlighted, and a sparkline of the latest runs. A step counts when it recorded a first token; speed also needs provider-reported output tokens. Samples from every Session this browser opens accumulate in `localStorage`, so the chart shows when a shared model is slow.

#### Speed history for other plugins

The plugin provides `activitySpeed`. `ctx.get('activitySpeed')?.expected(model, atMs)` returns `{ samples, ttftMs, tokensPerSecond }`, the medians for the local hour of `atMs` when that hour holds at least `speedMinBucketSamples` samples and otherwise the model's all-day medians, or undefined for an unseen model. A stall threshold can scale from it; nothing in this repository does yet.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`deriveTurnActivity`](src/client/activity.ts) folds the Chat target snapshot of [`ui-chat`](../ui-chat/README.md), which the Conversation assembly publishes at most once per animation frame. It picks the latest loaded Turn with a recorded `turn/start`. Step bars start at `step/start` and end at the Assistant's completion; a streaming step is classified by its newest block. Tool bars span `tool/call` to `tool/result`, follow each call's child calls recursively, and exclude calls still preparing their arguments. The cache share is cache reads over uncached input, cache reads, and cache writes, summed over the Turn's finished steps. [`ActivityPanel`](src/client/ActivityPanel.tsx) memoizes the fold on the snapshot's timeline and compatibility slice. Its clock ticks every 250 ms, or every second under reduced motion, and only while the tab is visible and the Turn is open. The context meter reads the `contextPressure` projection, and the job count reads the `jobs` rosters, which the body watches while mounted.

[`sampleSteps`](src/client/speed.ts) measures each finished, non-interrupted Assistant node that names its model and recorded a first token: time to first token is `step/start` to the first token, and speed is output tokens over the first token to the final message. `createSpeedHistory` keeps samples keyed `<sessionId>:<seq>` so a reloaded history adds nothing twice, bounds them by `speedSamples`, and persists them under `dsh.activity.speed`; blocked storage leaves an in-memory history. The browser keeps the history because the Host holds no per-step timing aggregate across Sessions; `sessionStats` sums whole-Session totals only. The Host half answers the git route with `workspaceChanges.repository`, which runs `rev-parse`, `log`, `diff --numstat`, and `ls-files --others` read-only. [`layoutGraph`](src/client/git-graph.ts) assigns lanes by tracking which commit each lane heads for.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-sidebar-right](../ui-sidebar-right/README.md) — the tab registry, guide page, and body seats.
- [ui-chat](../ui-chat/README.md) — the Chat target snapshot the timeline folds.
- [token-meter](../../llm/token-meter/README.md) — the `contextPressure` projection behind the context meter.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the Activity tab only reads Session state in the browser and adds nothing to a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The tab draws only what the Session log records.

- **A step with both reasoning and text is one writing bar.** The log records the first token and the completion of a step, not when reasoning gave way to text.
- **Subagent work is one bar.** A delegated subagent runs in its own Session; its steps and calls are not nested under the delegation.
- **Only loaded history counts.** A Turn whose start lies outside the loaded event window does not appear until that window is loaded.
- **The git graph needs a live Session.** The Host reads the repository of a Session it has loaded, and not for a subagent Session, so the section is absent until the Session is active.
- **Untracked files add no lines to the change count.** They count as files only.
- **Speed history is per browser.** It is not shared across devices or Hosts, and a step needs a recorded first token to count.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
