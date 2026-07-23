import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import { ObsidianAgent } from "./agent";
import type { ChatMessage } from "./openai";
import type AgentPlugin from "./main";

export const VIEW_TYPE_AGENT_CHAT = "agent-tools-chat";

export class AgentChatView extends ItemView {
  private agent: ObsidianAgent;
  private history: ChatMessage[] = [];
  private messagesEl!: HTMLElement;
  private usageEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private busy = false;

  constructor(leaf: WorkspaceLeaf, private plugin: AgentPlugin) {
    super(leaf);
    this.agent = new ObsidianAgent(this.app, plugin.settings, plugin.consent);
  }

  getViewType(): string { return VIEW_TYPE_AGENT_CHAT; }
  getDisplayText(): string { return "Agent chat"; }
  getIcon(): string { return "bot"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("agent-chat-root");

    // Header: context usage (left) + refresh action (right).
    const header = root.createDiv({ cls: "agent-chat-header" });
    this.usageEl = header.createSpan({ cls: "agent-chat-usage", text: "context ≈ 0 tok" });
    const refreshBtn = header.createEl("button", {
      cls: "agent-chat-refresh",
      attr: { "aria-label": "New conversation (clear context)" },
    });
    setIcon(refreshBtn, "rotate-ccw");
    refreshBtn.addEventListener("click", () => { this.resetConversation(); });

    this.messagesEl = root.createDiv({ cls: "agent-chat-messages" });

    const inputRow = root.createDiv({ cls: "agent-chat-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "agent-chat-input",
      attr: { placeholder: "Ask the agent… (Shift+Enter for newline)" },
    });
    this.sendBtn = inputRow.createEl("button", { cls: "agent-chat-send" });
    setIcon(this.sendBtn, "send");

    this.sendBtn.addEventListener("click", () => { void this.send(); });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });

    this.updateUsage();
  }

  /** Rough token estimate of the context window: chars / 4 (incl. system prompt allowance). */
  private estimateContextTokens(): number {
    let chars = 4000; // system prompt + memory + tool schemas allowance
    for (const m of this.history) {
      chars += (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
    }
    return Math.round(chars / 4);
  }

  private updateUsage(): void {
    const tok = this.estimateContextTokens();
    this.usageEl?.setText(`context ≈ ${tok >= 1000 ? (tok / 1000).toFixed(1) + "k" : tok} tok`);
  }

  private resetConversation(): void {
    if (this.busy) return;
    this.history = [];
    this.messagesEl.empty();
    this.addBubble("agent-msg-assistant", "Context cleared. New conversation started.");
    this.updateUsage();
  }

  private addBubble(cls: string, text: string): HTMLElement {
    const el = this.messagesEl.createDiv({ cls: `agent-msg ${cls}` });
    el.createSpan({ text });
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return el;
  }

  private async send(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.busy) return;
    if (!this.plugin.settings.apiKey) {
      new Notice("Agent Tools: please set the API key in settings first.");
      return;
    }

    this.busy = true;
    this.sendBtn.disabled = true;
    this.inputEl.value = "";
    this.addBubble("agent-msg-user", text);

    // Refresh agent in case settings changed.
    this.agent = new ObsidianAgent(this.app, this.plugin.settings, this.plugin.consent);

    const thinking = this.addBubble("agent-msg-assistant", "…");

    try {
      let lastAssistant = "";
      this.history = await this.agent.run(this.history, text, (e) => {
        if (e.type === "assistant") {
          lastAssistant = e.content;
          thinking.firstElementChild?.setText(e.content);
        } else if (e.type === "tool_call") {
          this.addBubble("agent-msg-tool", `⚙ ${e.name}(${e.content})`);
        } else if (e.type === "tool_result") {
          const short = e.content.length > 300 ? e.content.slice(0, 300) + "…" : e.content;
          this.addBubble("agent-msg-tool-result", `↳ ${short}`);
        }
      });
      if (!lastAssistant) thinking.firstElementChild?.setText("(no text answer)");
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    } catch (e) {
      thinking.firstElementChild?.setText(`Error: ${(e as Error).message}`);
      new Notice(`Agent error: ${(e as Error).message}`);
    } finally {
      this.busy = false;
      this.sendBtn.disabled = false;
    }
  }

  async onClose(): Promise<void> { /* nothing to clean */ }
}
