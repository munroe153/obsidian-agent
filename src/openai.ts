// Pure-JS OpenAI-compatible chat client (no dependencies, works with any
// OpenAI-style endpoint: OpenAI, DeepSeek, Moonshot, Ollama, LM Studio...)

import { requestUrl } from "obsidian";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface ChatCompletionOptions {
  baseUrl: string;   // e.g. https://api.openai.com/v1
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
}

export interface ChatCompletionResult {
  message: ChatMessage;
  finishReason: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * One non-streaming chat completion round via an OpenAI-compatible API.
 * Uses Obsidian's requestUrl to avoid CORS restrictions.
 */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const url = opts.baseUrl.replace(/\/+$/, "") + "/chat/completions";

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }

  const res = await requestUrl({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
    throw: false,
  });

  if (res.status >= 400) {
    let detail = "";
    try { detail = JSON.stringify(res.json); } catch { detail = res.text?.slice(0, 500) ?? ""; }
    throw new Error(`LLM API error ${res.status}: ${detail}`);
  }

  const data = res.json;
  const choice = data.choices?.[0];
  if (!choice) throw new Error("LLM API returned no choices");

  return {
    message: {
      role: "assistant",
      content: choice.message.content ?? null,
      tool_calls: choice.message.tool_calls,
    },
    finishReason: choice.finish_reason ?? "stop",
    usage: data.usage,
  };
}
