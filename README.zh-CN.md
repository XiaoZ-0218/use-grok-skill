# use-grok

[English](./README.md) | **简体中文**

Agent 无关的 CLI 桥接工具，用于对接 [Grok Build CLI](https://x.ai) (`grok`)。

`use-grok` 让任何 AI Agent、IDE 扩展、Shell 脚本或 CI 流水线都能调用 Grok 进行代码审查、设计 critique、任务委托以及图像生成/编辑——无需 Claude Code 或任何特定编辑器插件。

> 灵感来源于 [`grok-build-plugin-cc`](https://github.com/xai-org/grok-build-plugin-cc) Claude Code 插件。本项目沿用其核心设计理念，并将其重新封装为通用的 `npx use-grok` 命令，适用于所有环境。

## 环境要求

- Node.js `>= 18.18`
- Grok Build CLI (`grok`) 需在 `PATH` 中，或设置 `GROK_BINARY` 环境变量
- 已登录的 Grok CLI 会话（`grok models` 执行成功）

## 安装

```bash
# 无需安装即可运行
npx github:XiaoZ-0218/use-grok-skill check

# 或全局安装
npm install -g github:XiaoZ-0218/use-grok-skill
use-grok check
```

## 快速开始

```bash
# 检查 Node + Grok CLI 是否就绪
use-grok check

# 向 Grok 提问
use-grok ask "帮我解释一下这个代码库"

# 审查未提交的更改
use-grok review --scope working-tree

# 对当前分支进行 critique（对比 main）
use-grok critique --base main

# 将任务委托给 Grok（默认只读）
use-grok run "修复 auth 中的不稳定测试"

# 允许 Grok 编辑文件
use-grok run "应用最佳修复方案" --write

# 用 Grok 生成图像
use-grok image "一幅扁平风格的城市上空火箭插画" --out rocket.png --aspect-ratio 16:9

# 编辑已有图像
use-grok image "把天空改成日落" --ref rocket.png --out rocket-sunset.png
```

## 命令

### `use-grok check [--json]`

探测 Node、Grok CLI 以及认证的就绪状态。

### `use-grok ask <prompt> [--model <model>] [--effort low|medium|high] [--json]`

单轮问答。返回 Grok 的纯文本响应（加 `--json` 则返回 JSON）。

### `use-grok review [--wait] [--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--effort low|medium|high] [--json]`

对本地 Git 状态的只读审查。存在未提交更改时默认审查工作树，否则对比当前分支与默认基准分支。工作树范围涵盖暂存、未暂存以及未跟踪的更改。

### `use-grok critique [--wait] [--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--effort low|medium|high] [--json] [focus...]`

对抗性设计/风险 critique，尽可能输出结构化 JSON。适合在合并前或大型更改后使用。额外的位置参数将作为 critique 的关注主题。

### `use-grok run <prompt> [--background] [--write] [--model <model>] [--effort low|medium|high] [--json]`

将任务委托给 Grok。默认只读（`--permission-mode plan --sandbox read-only`）。加上 `--write` 可允许 Grok 编辑文件。

### `use-grok image <prompt> [--out <path>] [--aspect-ratio <ratio>] [--ref <image>...] [--background] [--wait] [--model <model>] [--effort low|medium|high] [--json]`

调用 Grok 内置的 `image_gen` 工具生成图像；传入一个或多个 `--ref` 参考图时，则使用 `image_edit` 编辑已有图像。最终图像保存到 `--out`（默认 `./grok-image-<时间戳>.png`）；`--json` 输出中包含 `out` 路径。支持的宽高比：`1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`auto`。

由于图像工具需要写文件，该命令始终以写权限运行 Grok（等同 `run --write`）。CLI 会指示 Grok 只写入指定的 `--out` 文件，但这只是提示词约束，并非沙箱隔离。运行结束后 CLI 会校验 `--out` 文件存在且非空，否则判定失败。

### `use-grok runs [run-id] [--wait] [--json]`

列出活跃和最近的运行，或等待特定运行完成。

### `use-grok show [run-id] [--json]`

查看已完成运行的存储输出。

### `use-grok stop [run-id] [--json]`

停止活跃的运行及其跟踪的进程树。

## 环境变量

| 变量 | 用途 |
|---|---|
| `GROK_BINARY` | `grok` 可执行文件的路径（默认为 `PATH` 中的 `grok`） |
| `USE_GROK_SESSION_ID` | 可选，用于隔离后台 Job 的会话 ID |
| `USE_GROK_STATE_DIR` | 覆盖用于存储运行状态的目录（默认为 `$TMPDIR/use-grok-runs/...`） |
| `TMPDIR` | 用于推导默认状态目录 |

## 后台 Job

`review`、`critique`、`image` 和 `run` 等耗时较长的命令可通过 `--background` 在后台排队。CLI 会将 Job 元数据和日志存储在工作区状态目录下，你可以使用 `runs`、`show` 和 `stop` 进行管理。对于 `review`、`critique` 和 `image`，加上 `--wait` 会阻塞直到后台运行完成并输出最终结果。

## Agent Skill

本仓库本身也是一个 Agent Skill：[SKILL.md](./SKILL.md) 包含了 Agent 驱动 CLI 所需的使用说明。将本目录复制或软链接到你的 Agent skills 路径（例如 `~/.agents/skills/use-grok/`）即可注册。

## JSON 输出

为任意命令添加 `--json` 即可获得机器可解析的输出。这在 `use-grok` 被其他 Agent 调用并需要根据结果做进一步处理时尤其有用。

## 退出码

- `0` — 成功
- `1` — 错误、运行失败或运行被取消
- `2` — 未知命令

## 开发

```bash
git clone https://github.com/XiaoZ-0218/use-grok-skill.git
cd use-grok-skill
npm test
```

测试使用 Node.js 内置测试运行器和 fake `grok` 二进制文件，无需真实的 Grok 账号。

## 致谢

本项目灵感来源于 [`grok-build-plugin-cc`](https://github.com/xai-org/grok-build-plugin-cc)，即官方的 Grok Build Claude Code 插件。`use-grok` 复用了其核心设计模式（只读审查、结构化 critique、后台 Job 追踪），但将其重新封装为通用的 CLI 工具。

## 许可证

Apache-2.0。详见 [LICENSE](./LICENSE)。
