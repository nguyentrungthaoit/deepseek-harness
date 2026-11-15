# Agent Note: Ship session search in the Web presets

Status: implemented

English | [中文](2026-10-28-ship-session-search-in-web-presets.zh.md)

## Problem

The company deployment runs models capped at a 128K context. Long work spans several Sessions, and the model had no way to look up what an earlier Session in the same workspace decided or changed, so users restated it or kept long Sessions alive. The [session-search-not-shipped-default note](../../archived/feature/2026-08-02-session-search-not-shipped-default.md) keeps `tool-session-query` out of every shipped surface.

## Decision

The `standard`, `ptc`, and `cordis` Web presets mount `@deepseek-ai/dsh-tool-session-query`, and the Web overlay turns full-text indexing on: `session-query-sqlite` uses a durable index at `dshHomePath('session-index.sqlite')` with `openAt: first-search`. The `minimal` preset, the base bundle, the TUI, and headless stay as before.

This supersedes the Web part of the not-shipped-default note for this fork. Authority is unchanged: a search reaches only Sessions whose `cwd` equals the caller's. The base `spill-policy` (`maxInlineTokens: 12500`) bounds oversized results.

## Alternatives considered

**Keep the in-memory index.** Rejected: every restart would rebuild the index on the first search; the derived file is disposable and lives beside the Session store.

**Mount the tool in the base bundle.** Rejected: only the Web surface was asked for, and the base row set also feeds headless and SDK surfaces.

**Mount it in `minimal` too.** Rejected: that preset exists to keep the request small.

## Consequences

- Every request in the three presets carries five more tool schemas and the tool guidance.
- The first search after a start indexes the Session history; later searches reuse the file.
- `session-index.sqlite` under the harness home can be deleted at any time; it is rebuilt.

## Testing

- `apps/web/tests/shipped-composition.e2e.ts` pins the five `session_*` tools in the default preset roster.
