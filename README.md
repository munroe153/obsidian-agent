# Agent

An AI agent for your vault. Chat with it in a sidebar or a dedicated tab, and it reads, searches, creates and edits your notes through 27 built-in tools. It speaks the OpenAI-compatible API, so you can use any provider and model you like — OpenAI, DeepSeek, Moonshot, Ollama, LM Studio and more. Works on both desktop and mobile, and it is free forever.

## Features

- **27 function-calling tools** over the vault API: read/list/search notes, create/append/overwrite/delete/rename files, metadata and backlinks, workspace commands, live editor selection/cursor edits, and dedicated YAML frontmatter operations.
- **OpenAI-compatible client**: any `/chat/completions` style endpoint works. Requests go through Obsidian's `requestUrl`, so there are no CORS issues.
- **Agent loop**: the model calls tools, results are fed back, and the loop continues until the model answers in plain text (iteration cap adjustable, optional unlimited mode).
- **Long-term memory & skills**: an `AGENT/` folder is created in your vault root with `memory.md` and `skills/`. Memory is injected into every conversation; skill files can be loaded by the agent on demand.
- **Two chat modes**: right sidebar (ribbon icon) or a standalone tab in the main area.

## Installation

### From the community plugin directory (recommended)

1. Open **Settings → Community plugins** in Obsidian and turn off restricted mode.
2. Click **Browse**, search for **Agent**, then click **Install** and **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/munroe153/obsidian-agent/releases/latest).
2. Create a folder `<your-vault>/.obsidian/plugins/agent/` and copy the three files into it.
3. Restart Obsidian, then enable **Agent** under **Settings → Community plugins**.

## Usage

1. Open the plugin settings and fill in **Base URL**, **API key** and **Model** (e.g. DeepSeek: `https://api.deepseek.com/v1` + `deepseek-chat`).
2. Open the chat panel:
   - Click the robot ribbon icon (opens according to the **Chat open mode** setting), or
   - Run the command **Open chat in sidebar** / **Open chat in a new tab** from the command palette.
3. Type your request and press Enter. Type `@` to fuzzy-match and reference vault notes — referenced files' contents are attached automatically. Tool calls and their results are shown inline in the chat.
4. Try things like:
   - "List all notes in the vault root and summarize my note structure"
   - "Find every note mentioning 'deadline' and compile a TODO table into `Tasks.md`"
   - "Show me the backlinks of the currently open note"

### Settings

- **Chat open mode**: where the ribbon icon opens the chat (sidebar or tab).
- **Require confirmation**: ask before any vault-modifying tool runs (with diff preview for overwrite/replace).
- **Truncate long files** + **Max lines per read**: manual switch and line threshold for how much file content is uploaded per tool call.
- **Max tool iterations**: safety cap on tool-call rounds per message (1–30).
- **Unlimited mode (超限模式)**: removes the cap; the agent keeps calling tools until the model stops on its own.

## Safety

`overwrite_note` and `delete_file` modify your vault directly. The agent is instructed to prefer small, safe edits, but please evaluate model behavior yourself and back up important notes.

---

## 中文说明

将 Obsidian API 封装为 27 个 LLM function-calling 工具，内置纯 JS（零依赖）的 OpenAI 兼容 agent，以聊天方式驱动它操作你的笔记库，桌面端与移动端体验一致。

### 使用

1. 设置页填入 Base URL / API Key / Model（如 DeepSeek：`https://api.deepseek.com/v1` + `deepseek-chat`）。
2. 点击 ribbon 机器人图标，或用命令面板执行 “Open chat in sidebar” / “Open chat in a new tab” 打开聊天面板。
3. 首次启用会自动在库根目录创建 `AGENT/memory.md` 与 `AGENT/skills/`；记忆全文与技能列表会自动注入 system prompt。

### 安全提示

`overwrite_note` / `delete_file` 会直接修改你的库。agent 受 system prompt 约束（优先小改动），但请自行评估模型行为，重要笔记先备份。
