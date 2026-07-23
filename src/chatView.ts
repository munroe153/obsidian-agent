import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { ObsidianAgent } from "./agent";
import { truncateText } from "./tools";
import type { ChatMessage } from "./openai";
import type AgentPlugin from "./main";

const MAX_FILE_REFS = 5;
const MAX_SUGGESTIONS = 8;

export const VIEW_TYPE_AGENT_CHAT = "agent-tools-chat";

export class AgentChatView extends ItemView {
  private agent: ObsidianAgent;
  private history: ChatMessage[] = [];
  private messagesEl!: HTMLElement;
  private usageEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private busy = false;

  // @ file-reference suggestions
  private suggestEl?: HTMLElement;
  private suggestFiles: TFile[] = [];
  private suggestIdx = 0;
  private suggestFrom = -1; // caret index of the active '@'

  constructor(leaf: WorkspaceLeaf, private plugin: AgentPlugin) {
    super(leaf);
    this.agent = new ObsidianAgent(this.app, plugin.settings, plugin.consent, plugin.undo);
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
      attr: { placeholder: "Ask the agent… (@ to reference notes, Shift+Enter for newline)" },
    });
    this.sendBtn = inputRow.createEl("button", { cls: "agent-chat-send" });
    setIcon(this.sendBtn, "send");

    // Dropdown for @ file references, anchored above the input row.
    this.suggestEl = inputRow.createDiv({ cls: "agent-suggest" });
    this.suggestEl.style.display = "none";

    this.sendBtn.addEventListener("click", () => {
      if (this.busy) {
        // While running, the send button acts as a stop button.
        this.agent.cancel();
        new Notice("Agent: stopping…");
      } else {
        void this.send();
      }
    });
    this.inputEl.addEventListener("input", () => { this.updateSuggestions(); });
    this.inputEl.addEventListener("keydown", (e) => {
      if (this.suggestFiles.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          this.suggestIdx = (this.suggestIdx + 1) % this.suggestFiles.length;
          this.renderSuggestions();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          this.suggestIdx = (this.suggestIdx - 1 + this.suggestFiles.length) % this.suggestFiles.length;
          this.renderSuggestions();
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          this.pickSuggestion(this.suggestFiles[this.suggestIdx]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          this.closeSuggestions();
          return;
        }
      }
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

  // ---------- @ file references ----------

  private updateSuggestions(): void {
    const caret = this.inputEl.selectionStart ?? 0;
    const upToCaret = this.inputEl.value.slice(0, caret);
    const at = upToCaret.lastIndexOf("@");
    if (at < 0 || upToCaret.slice(at).includes("\n")) { this.closeSuggestions(); return; }
    // '@' must start a token (beginning of text or after whitespace).
    if (at > 0 && !/\s/.test(upToCaret[at - 1])) { this.closeSuggestions(); return; }
    const query = upToCaret.slice(at + 1).toLowerCase();
    this.suggestFiles = this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.toLowerCase().includes(query))
      .sort((a, b) => a.path.length - b.path.length)
      .slice(0, MAX_SUGGESTIONS);
    this.suggestFrom = at;
    this.suggestIdx = 0;
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    const el = this.suggestEl;
    if (!el) return;
    el.empty();
    if (this.suggestFiles.length === 0) {
      el.style.display = "none";
      return;
    }
    this.suggestFiles.forEach((f, i) => {
      const item = el.createDiv({ cls: `agent-suggest-item${i === this.suggestIdx ? " is-active" : ""}` });
      item.setText(f.path);
      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep textarea focus
        this.pickSuggestion(f);
      });
    });
    el.style.display = "block";
  }

  private pickSuggestion(file: TFile): void {
    const caret = this.inputEl.selectionStart ?? 0;
    const before = this.inputEl.value.slice(0, this.suggestFrom);
    const after = this.inputEl.value.slice(caret);
    const inserted = `@${file.path} `;
    this.inputEl.value = before + inserted + after;
    const pos = (before + inserted).length;
    this.inputEl.setSelectionRange(pos, pos);
    this.closeSuggestions();
    this.inputEl.focus();
  }

  private closeSuggestions(): void {
    this.suggestFiles = [];
    this.suggestFrom = -1;
    if (this.suggestEl) this.suggestEl.style.display = "none";
  }

  /** Expand @path references in the message into file contents for the model. */
  private async buildPayload(text: string): Promise<string> {
    const refs = this.app.vault.getMarkdownFiles()
      .filter((f) => text.includes(`@${f.path}`))
      .slice(0, MAX_FILE_REFS);
    if (refs.length === 0) return text;
    const cfg = {
      enabled: this.plugin.settings.truncateEnabled !== false,
      maxLines: this.plugin.settings.truncateMaxLines > 0 ? this.plugin.settings.truncateMaxLines : 200,
    };
    const parts: string[] = [];
    for (const f of refs) {
      try {
        const content = truncateText(await this.app.vault.read(f), cfg);
        parts.push(`<file path="${f.path}">\n${content}\n</file>`);
      } catch {
        // Skip unreadable files silently.
      }
    }
    if (parts.length === 0) return text;
    return `${text}\n\n<referenced-files>\n${parts.join("\n\n")}\n</referenced-files>`;
  }

  private async send(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.busy) return;
    if (!this.plugin.settings.apiKey) {
      new Notice("Agent Tools: please set the API key in settings first.");
      return;
    }

    this.busy = true;
    this.sendBtn.disabled = false;
    setIcon(this.sendBtn, "square"); // stop icon while running
    this.sendBtn.setAttr("aria-label", "Stop the agent");
    this.inputEl.value = "";
    this.closeSuggestions();
    this.addBubble("agent-msg-user", text);
    const payload = await this.buildPayload(text);

    // Refresh agent in case settings changed.
    this.agent = new ObsidianAgent(this.app, this.plugin.settings, this.plugin.consent, this.plugin.undo);

    const thinking = this.addBubble("agent-msg-assistant", "…");

    try {
      let lastAssistant = "";
      this.history = await this.agent.run(this.history, payload, (e) => {
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
      setIcon(this.sendBtn, "send");
      this.sendBtn.setAttr("aria-label", "Send");
      this.sendBtn.disabled = false;
    }
  }

  async onClose(): Promise<void> { /* nothing to clean */ }
}
