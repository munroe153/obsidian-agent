// Pure-JS agent loop: chat -> tool_calls -> execute Obsidian tools -> repeat
// until the model answers with plain text or max iterations is reached.

import { App } from "obsidian";
import { chatCompletion, ChatMessage } from "./openai";
import { buildObsidianTools, Tool } from "./tools";
import { ensureAgentWorkspace, loadMemory, listSkills } from "./memory";
import type { AgentSettings } from "./settings";

export interface AgentEvent {
  type: "tool_call" | "tool_result" | "assistant" | "error";
  name?: string;
  content: string;
}

export type AgentEventHandler = (e: AgentEvent) => void;

const BASE_PROMPT = `You are an AI agent embedded in Obsidian. You can act on the user's vault through the provided tools (read/create/edit/search notes, metadata, backlinks, workspace commands, direct editor text interaction, YAML frontmatter operations).

Guidelines:
- Use tools to gather facts before answering questions about the vault; do not guess note contents.
- Prefer small, safe edits: append, find_replace_in_note, frontmatter tools or selection/cursor edits over overwrite.
- When you modify files, tell the user exactly what you changed.
- Vault-relative paths always end with .md for notes.
- Your workspace is the AGENT/ folder: AGENT/memory.md is your long-term memory (always injected below; persist important facts with update_memory), AGENT/skills/ holds reusable skill files — when a listed skill matches the task, call read_skill to load and follow it.`;

export async function buildSystemPrompt(app: App): Promise<string> {
  await ensureAgentWorkspace(app);
  const [memory, skills] = await Promise.all([loadMemory(app), listSkills(app)]);
  const skillLines = skills.length
    ? skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")
    : "(no skills yet — .md files in AGENT/skills/ become skills)";
  return `${BASE_PROMPT}

<Long-term memory (AGENT/memory.md)>
${memory.trim() || "(empty)"}
</Long-term memory>

<Available skills (AGENT/skills/) — load one with read_skill when relevant>
${skillLines}
</Available skills>`;
}

export class ObsidianAgent {
  private tools: Tool[];
  private toolMap: Map<string, Tool>;

  constructor(private app: App, private settings: AgentSettings) {
    this.tools = buildObsidianTools(app);
    this.toolMap = new Map(this.tools.map((t) => [t.definition.function.name, t]));
  }

  get toolNames(): string[] {
    return this.tools.map((t) => t.definition.function.name);
  }

  async run(
    history: ChatMessage[],
    userInput: string,
    onEvent: AgentEventHandler
  ): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [
      { role: "system", content: await buildSystemPrompt(this.app) },
      ...history,
      { role: "user", content: userInput },
    ];

    // Unlimited mode (超限模式): no cap — loop until the model stops calling tools.
    const unlimited = this.settings.unlimitedIterations === true;
    const maxIterations = unlimited ? Infinity : this.settings.maxIterations ?? 10;

    for (let i = 0; i < maxIterations; i++) {
      const result = await chatCompletion({
        baseUrl: this.settings.baseUrl,
        apiKey: this.settings.apiKey,
        model: this.settings.model,
        messages,
        tools: this.tools.map((t) => t.definition),
      });

      const msg = result.message;
      messages.push(msg);

      if (msg.content) {
        onEvent({ type: "assistant", content: msg.content });
      }

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        // Done — final assistant answer.
        return messages.slice(1); // strip system
      }

      // Execute requested tool calls.
      for (const call of msg.tool_calls) {
        const name = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }

        onEvent({ type: "tool_call", name, content: JSON.stringify(args) });

        const tool = this.toolMap.get(name);
        let output: unknown;
        if (!tool) {
          output = { ok: false, error: `Unknown tool: ${name}` };
        } else {
          try {
            output = await tool.execute(args);
          } catch (e) {
            output = { ok: false, error: (e as Error).message };
          }
        }

        const content = JSON.stringify(output);
        onEvent({ type: "tool_result", name, content });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content,
        });
      }
    }

    const limitMsg: ChatMessage = {
      role: "assistant",
      content: `Stopped: reached the maximum of ${this.settings.maxIterations ?? 10} tool iterations.`,
    };
    messages.push(limitMsg);
    onEvent({ type: "assistant", content: limitMsg.content! });
    return messages.slice(1);
  }
}
