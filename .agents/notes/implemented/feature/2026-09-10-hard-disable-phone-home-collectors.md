# Agent Note: Hard-disable phone-home collectors in shipped base

Status: implemented

English | [中文](2026-09-10-hard-disable-phone-home-collectors.zh.md)

## Problem

Default installations still composed collectors that could receive Session prefixes: the shared base resolved an unset `DSH_TELEMETRY_MODE` to `FEEDBACK_ONLY`, and environment overrides could re-enable OTel through the base patch. Product LLM egress and web tools do not need those collectors; a default install must not phone home with session data.

## Decision

Shipped `dsh-base` hard-disables OTel session telemetry with a `mode: DISABLED` literal and pins `session-log-deepseek` `enabled: false`. Collectors no longer receive session prefixes from the default base. Product LLM egress and web tools stay unchanged.

This supersedes the base default in the [feedback-gated telemetry default](../../archived/feature/2026-08-25-feedback-gated-telemetry-default.md) note: the base no longer resolves an unset `DSH_TELEMETRY_MODE` to `FEEDBACK_ONLY`. The plugin's `DEFAULT_TELEMETRY_MODE` is `DISABLED`, so an omitted `mode` never uploads. `DSH_TELEMETRY_MODE` and `DSH_TELEMETRY_OTLP_URL` no longer re-enable upload through the base patch; a custom overlay can still remount `FEEDBACK_ONLY` deliberately. The base row names no collector, so that overlay must also supply its own `exporter.url`.

The entry points that fed these paths are off too. The base disables `command-feedback`, so `/feedback` is gone. The Web bundle disables `ui-message-feedback` (Like/Dislike and the feedback dialog) and `ui-settings-session-log` (the **Upload Session Log** switch in General). `message-feedback` stays mounted: it only writes the local Session log and sends nothing. Product analytics (`desktop-product-telemetry` and `product-analytics`) is disabled in every profile, Desktop included.

## Alternatives considered

**Keep feedback-gated OTel as the shipped base default.** Rejected: default installs must not send session prefixes to collectors; feedback-gated release remains available only through an explicit overlay.

**Remove the OTel and DeepSeek session-log plugins from the base patch entirely.** Rejected: keeping the rows mounted with hard-off defaults preserves a single remount path and keeps opt-in overlays local to mode and `enabled` flips.

**Leave environment-driven re-enable in the base patch.** Rejected: `DSH_TELEMETRY_MODE` / `DSH_TELEMETRY_OTLP_URL` must not turn collectors back on without an intentional overlay.

## Consequences

- Default profiles built on `dsh-base` construct no OTel transport and do not register the DeepSeek session-log contribution.
- Deployments that need feedback-gated upload remount `FEEDBACK_ONLY` (and any exporter URL) in a custom overlay; the [feedback-gated note](../../archived/feature/2026-08-25-feedback-gated-telemetry-default.md) retains that mode's rationale.
- Non-empty `DSH_TELEMETRY_DISABLED` still disables the OTel row at launch when the row is present.
- Web shows no feedback buttons, no feedback dialog, and no Session-log upload switch. A home patch that already set `session-log-deepseek` `enabled: true` still wins over the base.
- The `/feedback` and message-feedback Web e2e scenarios are removed; the Host Remote protocol snapshot for `messageFeedback` stays.

## Testing

- `packages/bundle/base` tests pin the hard-off composition, including `/feedback`.
- `packages/bundle/web-app` product-analytics tests pin both rows disabled in Desktop and Web, with no collector request.
- `session-telemetry-otel` default-mode tests pin omitted `mode` as `DISABLED`, with no delivery after feedback.
