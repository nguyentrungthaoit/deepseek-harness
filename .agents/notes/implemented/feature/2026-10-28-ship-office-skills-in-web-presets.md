# Agent Note: Ship the Office skills in the Web presets

Status: implemented

English | [中文](2026-10-28-ship-office-skills-in-web-presets.zh.md)

## Problem

Company users of the Docker Web image ask for Word, Excel, and PowerPoint deliverables. The image carries `python-docx`, `openpyxl`, `pandas`, and LibreOffice Kit, but the Web presets mount neither [`skill-office`](../../../../packages/skill/skill-office/README.md) nor `load_workspace_dependencies`. The model writes Office files from memory, without the edit rules, the structural checker, or the PDF export path, and `python-pptx` is absent.

## Decision

The `standard`, `ptc`, and `cordis` Web presets mount `@deepseek-ai/dsh-tool-workspace-dependencies` and `@deepseek-ai/dsh-skill-office` after `tool-skill`. Both rows are disabled unless `DSH_PRIMARY_RUNTIME` is a nonempty path, the same gate the `sdk` profile uses. `skill-office` keeps its packaged assets, the current Node executable, and the installed LibreOffice Kit CLI.

The Docker image becomes that payload: `/opt/dsh-runtime/dependencies/python` links to the existing `/opt/dsh-py` venv, and a build step writes `runtime.json` from the venv's Python version and installed distributions. The venv adds `python-pptx` and `XlsxWriter` at the versions in the [primary-runtime lock](../../../../scripts/primary-runtime/lock.json). The image sets `DSH_PRIMARY_RUNTIME=/opt/dsh-runtime`.

## Alternatives considered

**Copy the `prepare:primary-runtime` payload into the image.** Rejected: it downloads a second standalone Python beside the venv the image already has, and the agent's `python3` on `PATH` would differ from the one the skills name.

**Mount the rows unconditionally.** Rejected: source launches and Web hosts without a payload would fail the first `load_workspace_dependencies` call.

## Consequences

- Docker Web requests in the three presets carry one more tool schema and three skill descriptions in the catalog.
- `DSH_PRIMARY_RUNTIME=` (empty) turns both rows off without a profile edit.
- `pip install` into `/opt/dsh-py` changes the venv but not `runtime.json`, so the reported distributions list only the image's packages.

## Testing

- Unit and composition tests run with `DSH_PRIMARY_RUNTIME` unset, so the shipped tool roster is unchanged.
- The image build exercises the manifest step; the first `load_workspace_dependencies` call in the container validates the payload.
