# Agent Note: 在 Web 预设中随附 Office skill

Status: implemented

[English](2026-10-28-ship-office-skills-in-web-presets.md) | 中文

## 问题

使用 Docker Web 镜像的公司用户需要 Word、Excel 和 PowerPoint 交付物。镜像带有 `python-docx`、`openpyxl`、`pandas` 和 LibreOffice Kit，但 Web 预设既不挂载 [`skill-office`](../../../../packages/skill/skill-office/README.zh.md)，也不挂载 `load_workspace_dependencies`。模型凭记忆编写 Office 文件，没有编辑规则、结构检查器和 PDF 导出路径，而且缺少 `python-pptx`。

## 决定

`standard`、`ptc` 和 `cordis` Web 预设在 `tool-skill` 之后挂载 `@deepseek-ai/dsh-tool-workspace-dependencies` 和 `@deepseek-ai/dsh-skill-office`。除非 `DSH_PRIMARY_RUNTIME` 是非空路径，这两行都处于禁用状态，与 `sdk` profile 使用同一开关。`skill-office` 沿用其打包的资源、当前 Node 可执行文件和已安装的 LibreOffice Kit CLI。

Docker 镜像本身就是该载荷：`/opt/dsh-runtime/dependencies/python` 链接到现有的 `/opt/dsh-py` venv，构建步骤根据该 venv 的 Python 版本和已安装的发行包写出 `runtime.json`。venv 按 [primary-runtime 锁文件](../../../../scripts/primary-runtime/lock.json)中的版本加入 `python-pptx` 和 `XlsxWriter`。镜像设置 `DSH_PRIMARY_RUNTIME=/opt/dsh-runtime`。

## 考虑过的替代方案

**把 `prepare:primary-runtime` 载荷复制进镜像。** 否决：它会在镜像已有的 venv 旁再下载一个独立 Python，且 `PATH` 上 agent 使用的 `python3` 会与 skill 指定的不同。

**无条件挂载这两行。** 否决：没有载荷的源码启动和 Web 宿主会在第一次调用 `load_workspace_dependencies` 时失败。

## 影响

- 三个预设中的 Docker Web 请求在目录中多带一个工具 schema 和三条 skill 描述。
- `DSH_PRIMARY_RUNTIME=`（空值）无需修改 profile 即可关闭这两行。
- `pip install` 到 `/opt/dsh-py` 会改变 venv 但不会改变 `runtime.json`，因此报告的发行包只列出镜像自带的包。

## 测试

- 单元测试和组合测试在未设置 `DSH_PRIMARY_RUNTIME` 时运行，因此随附的工具清单不变。
- 镜像构建会执行清单步骤；容器内第一次调用 `load_workspace_dependencies` 会校验载荷。
