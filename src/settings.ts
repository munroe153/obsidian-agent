import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { listModels } from "./openai";
import type AgentPlugin from "./main";

export interface AgentSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxIterations: number;
  unlimitedIterations: boolean;
  openMode: "sidebar" | "tab";
  requireConsent: boolean;
  truncateEnabled: boolean;
  truncateMaxLines: number;
}

export const DEFAULT_SETTINGS: AgentSettings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  maxIterations: 10,
  unlimitedIterations: false,
  openMode: "sidebar",
  requireConsent: true,
  truncateEnabled: true,
  truncateMaxLines: 200,
};

export class AgentSettingTab extends PluginSettingTab {
  private fetchedModels: string[] = [];
  private modelManual = false;
  private autoFetched = false;

  constructor(app: App, private plugin: AgentPlugin) {
    super(app, plugin);
  }

  /** Model picker: dropdown populated from the endpoint's /models, with a
   * refresh button and a manual-input fallback (openagent-style). */
  private renderModelSetting(containerEl: HTMLElement): void {
    const current = this.plugin.settings.model;
    const setting = new Setting(containerEl)
      .setName("Model")
      .setDesc("Pick a model from the endpoint (refresh to fetch the list), or type one manually.");

    if (this.modelManual) {
      setting.addText((t) =>
        t.setPlaceholder("e.g. gpt-4o-mini, deepseek-chat")
          .setValue(current)
          .onChange(async (v) => {
            this.plugin.settings.model = v.trim();
            await this.plugin.saveSettings();
          })
      );
    } else {
      setting.addDropdown((d) => {
        const options = this.fetchedModels.includes(current)
          ? this.fetchedModels
          : [current, ...this.fetchedModels];
        for (const m of options) d.addOption(m, m || "(not set)");
        d.setValue(current).onChange(async (v) => {
          this.plugin.settings.model = v;
          await this.plugin.saveSettings();
        });
      });
    }

    setting.addExtraButton((b) =>
      b.setIcon("rotate-cw")
        .setTooltip("Fetch model list from the endpoint")
        .onClick(async () => {
          const { baseUrl, apiKey } = this.plugin.settings;
          if (!baseUrl) {
            new Notice("Agent: set the Base URL first.");
            return;
          }
          new Notice("Agent: fetching model list…");
          const models = await listModels(baseUrl, apiKey);
          if (models.length === 0) {
            new Notice("Agent: no models returned (check Base URL / API key) — switched to manual input.");
            this.modelManual = true;
          } else {
            new Notice(`Agent: found ${models.length} model(s).`);
            this.fetchedModels = models;
            this.modelManual = false;
          }
          this.display();
        })
    );

    setting.addExtraButton((b) =>
      b.setIcon(this.modelManual ? "list" : "pencil")
        .setTooltip(this.modelManual ? "Switch to dropdown" : "Switch to manual input")
        .onClick(() => {
          this.modelManual = !this.modelManual;
          this.display();
        })
    );
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("OpenAI-compatible API base, e.g. https://api.openai.com/v1 or http://localhost:11434/v1 (Ollama)")
      .addText((t) =>
        t.setValue(this.plugin.settings.baseUrl).onChange(async (v) => {
          this.plugin.settings.baseUrl = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Bearer token for the API.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(this.plugin.settings.apiKey).onChange(async (v) => {
          this.plugin.settings.apiKey = v.trim();
          await this.plugin.saveSettings();
        });
      });

    this.renderModelSetting(containerEl);

    new Setting(containerEl)
      .setName("Chat open mode")
      .setDesc("Where the ribbon icon opens the agent chat. Both commands stay available regardless.")
      .addDropdown((d) =>
        d
          .addOption("sidebar", "Sidebar (right dock)")
          .addOption("tab", "Standalone tab (main area)")
          .setValue(this.plugin.settings.openMode)
          .onChange(async (v) => {
            this.plugin.settings.openMode = v as "sidebar" | "tab";
            await this.plugin.saveSettings();
          })
      );

    const sliderSetting = new Setting(containerEl)
      .setName("Max tool iterations")
      .setDesc("Safety cap on tool-call rounds per user message.")
      .addSlider((s) => {
        const valueEl = containerEl.createSpan({ cls: "agent-slider-value", text: String(this.plugin.settings.maxIterations) });
        s.setLimits(1, 30, 1)
          .setValue(this.plugin.settings.maxIterations)
          .onChange(async (v) => {
            this.plugin.settings.maxIterations = v;
            valueEl.setText(String(v));
            await this.plugin.saveSettings();
          });
        s.sliderEl.addClass("agent-slider");
      });

    new Setting(containerEl)
      .setName("Unlimited mode (超限模式)")
      .setDesc("Remove the iteration cap: tool calls continue until the model stops calling tools. Disables the cap above.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.unlimitedIterations).onChange(async (v) => {
          this.plugin.settings.unlimitedIterations = v;
          sliderSetting.setDisabled(v);
          await this.plugin.saveSettings();
        })
      );
    sliderSetting.setDisabled(this.plugin.settings.unlimitedIterations);

    new Setting(containerEl)
      .setName("Require confirmation")
      .setDesc("Ask for approval before any tool that modifies the vault or runs commands (delete, overwrite, edit, frontmatter, commands). Recommended.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.requireConsent).onChange(async (v) => {
          this.plugin.settings.requireConsent = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Truncate long files")
      .setDesc("Limit how much of a file the agent uploads in one tool call. Turn off to always send full content (may exceed context or cost more tokens).")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.truncateEnabled).onChange(async (v) => {
          this.plugin.settings.truncateEnabled = v;
          linesSetting.setDisabled(!v);
          await this.plugin.saveSettings();
        })
      );

    const linesSetting = new Setting(containerEl)
      .setName("Max lines per read")
      .setDesc("Line threshold for truncation: tools return at most this many lines per call (10–2000).")
      .addSlider((s) => {
        const valueEl = containerEl.createSpan({ cls: "agent-slider-value", text: String(this.plugin.settings.truncateMaxLines) });
        s.setLimits(10, 2000, 10)
          .setValue(this.plugin.settings.truncateMaxLines)
          .onChange(async (v) => {
            this.plugin.settings.truncateMaxLines = v;
            valueEl.setText(String(v));
            await this.plugin.saveSettings();
          });
        s.sliderEl.addClass("agent-slider");
      });
    linesSetting.setDisabled(!this.plugin.settings.truncateEnabled);

    // Auto-fetch the model list once when the tab opens (if possible).
    if (!this.autoFetched && this.fetchedModels.length === 0 && this.plugin.settings.baseUrl) {
      this.autoFetched = true;
      void listModels(this.plugin.settings.baseUrl, this.plugin.settings.apiKey).then((models) => {
        if (models.length > 0 && !this.modelManual) {
          this.fetchedModels = models;
          this.display();
        }
      });
    }
  }
}
