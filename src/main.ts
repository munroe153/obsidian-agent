import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { AgentSettings, AgentSettingTab, DEFAULT_SETTINGS } from "./settings";
import { AgentChatView, VIEW_TYPE_AGENT_CHAT } from "./chatView";
import { ensureAgentWorkspace } from "./memory";

export default class AgentPlugin extends Plugin {
  settings!: AgentSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Bootstrap the AGENT/ workspace (memory.md + skills/) in the vault root.
    this.app.workspace.onLayoutReady(() => {
      ensureAgentWorkspace(this.app).catch((e) => {
        console.error("[agent-tools] failed to create AGENT workspace", e);
        new Notice(`Agent Tools: failed to create AGENT folder: ${(e as Error).message}`);
      });
    });

    this.registerView(
      VIEW_TYPE_AGENT_CHAT,
      (leaf) => new AgentChatView(leaf, this)
    );

    this.addRibbonIcon("bot", "Open agent chat", () => {
      void this.activateView(this.settings.openMode);
    });

    this.addCommand({
      id: "open-agent-chat-sidebar",
      name: "Open agent chat in sidebar",
      callback: () => { void this.activateView("sidebar"); },
    });

    this.addCommand({
      id: "open-agent-chat-tab",
      name: "Open agent chat in a new tab",
      callback: () => { void this.activateView("tab"); },
    });

    this.addSettingTab(new AgentSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_AGENT_CHAT);
  }

  async activateView(mode: "sidebar" | "tab" = "sidebar"): Promise<void> {
    const { workspace } = this.app;

    // Reuse an existing chat leaf that already lives in the requested area.
    const existing = workspace
      .getLeavesOfType(VIEW_TYPE_AGENT_CHAT)
      .find((leaf) => this.isLeafInArea(leaf, mode));

    let leaf: WorkspaceLeaf | null | undefined = existing;
    if (!leaf) {
      leaf =
        mode === "tab"
          ? workspace.getLeaf("tab")
          : workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_AGENT_CHAT, active: true });
      }
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  /** Whether the leaf sits in the root (main tab area) vs. a side dock. */
  private isLeafInArea(leaf: WorkspaceLeaf, mode: "sidebar" | "tab"): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root: any = (this.app.workspace as any).rootSplit;
    let node: unknown = leaf;
    // Walk up the split-tree parents until we hit a root-level child.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    while ((node as any)?.parent) node = (node as any).parent;
    const inRoot = root ? (root as { children?: unknown[] }).children?.includes(node) ?? false : true;
    return mode === "tab" ? inRoot : !inRoot;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
