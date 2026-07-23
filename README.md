# Agent — Obsidian 插件

将 Obsidian API 封装为一组 LLM function-calling tools，内置一个**纯 JS（零依赖）的 OpenAI 兼容 agent**，以聊天方式驱动它操作你的笔记库。开创性的架构设计实现了跨平台一致性体验，便于您搭建全平台工作流。

## 手动安装流程
1. 在发行版中下载源码压缩包，解压复制里面的三个文件（main.js, mainfest.json, styles.css）
2. 在文件系统中找到 <你的仓库名>/.obsidian/plugins/
3. 在plugins下新建文件夹agent
4. 在 <你的仓库名>/.obsidian/plugins/agent/ 下放入三份文件
5. 在第三方插件设置里打开插件即可

## 功能

- **OpenAI 兼容客户端**（`src/openai.ts`）：基于 Obsidian `requestUrl`（无 CORS 限制），支持任何 `/chat/completions` 风格的端点——OpenAI、DeepSeek、Moonshot、Ollama、LM Studio 等。
- **Obsidian API → Tools**（`src/tools.ts`），共 27 个工具：
  - 读取：`read_note`（截断+分页）、`list_files`、`search_notes`
  - 写入：`create_note`、`append_to_note`、`overwrite_note`、`delete_file`、`rename_file`
  - 元数据：`get_note_metadata`、`get_backlinks`
  - 工作区：`open_note`、`get_active_note`、`run_command`、`list_commands`
  - 记忆/技能：`read_memory`、`update_memory`、`list_skills`、`read_skill`
  - 文本直接交互：`get_active_selection`、`replace_active_selection`、`insert_at_cursor`、`find_replace_in_note`
  - YAML frontmatter 专属：`get_frontmatter`（只读 yaml 块）、`set_frontmatter_key`、`update_frontmatter`（合并）、`delete_frontmatter_keys`、`replace_frontmatter`（整块替换）——只操作文件头部 yaml，正文不动；值可用 JSON 字符串传数组/数字/布尔
- **Agent 循环**（`src/agent.ts`）：LLM 返回 `tool_calls` → 本地执行 → 结果回填 → 继续，直到输出纯文本或达到迭代上限（默认 10 轮，可调）。
- **聊天视图**（`src/chatView.ts`）：气泡聊天，实时显示工具调用与结果。支持两种交互模式——右侧边栏（ribbon 图标 / 命令 "Open agent chat in sidebar"）或独立标签页（命令 "Open agent chat in a new tab"）。

## 使用

1. 设置页填入 Base URL / API Key / Model（如 DeepSeek：`https://api.deepseek.com/v1` + `deepseek-chat`）。
2. 打开聊天面板（两种模式）：ribbon 机器人图标按设置页的 "Chat open mode" 打开；命令面板可随时用 "Open agent chat in sidebar"（右侧边栏）或 "Open agent chat in a new tab"（主区独立标签页）。两种模式各自复用本区域内已有窗口。
3. 设置页可拖动调整工具调用最高轮次（1–30，拖动时实时显示数值）；打开 **Unlimited mode（超限模式）** 开关后取消轮次上限，工具调用持续到模型主动停止（此时滑块被禁用）。
4. 首次启用时插件自动在库根目录创建 `AGENT/memory.md` 与 `AGENT/skills/example-skill.md`；对话时记忆全文与技能列表自动注入 system prompt。
5. 试试：
   - 「列出根目录所有笔记，给我一份笔记结构总结」
   - 「搜索所有提到『截止日期』的笔记，整理成一张 TODO 表，新建到 `Tasks.md`」
   - 「把当前打开的笔记的反向链接找出来」

## 架构

```
用户消息 ──▶ agent.run()
              │  chatCompletion(messages, tools)   ← 纯 fetch，OpenAI 格式
              │  若返回 tool_calls:
              │    本地执行 Obsidian API ──▶ role:"tool" 消息回填
              │    循环（上限 maxIterations）
              ▼
            最终文本回答，历史保留用于多轮对话
```

## 安全提示

`overwrite_note` / `delete_file` 会直接修改你的库。agent 受 system prompt 约束（优先小改动），但请自行评估模型行为，重要笔记先备份。
