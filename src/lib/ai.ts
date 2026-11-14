import { isTauri } from "@tauri-apps/api/core";
import type { ModelMessage } from "../core/model";
import { prepareConversationRequest } from "./conversationRequest";
import { createTauriModelRouter, NATIVE_MODEL_PROVIDER_ID } from "./tauriModelProvider";
import type { ChatMessage, ProviderSettings } from "../types";

export async function sendMessage(
  settings: ProviderSettings,
  messages: ChatMessage[],
  knowledgeContext = "",
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
  onUsage?: (usage: { inputTokens?: number; outputTokens?: number }) => void,
  generation?: { temperature?: number; maxOutputTokens?: number },
  gatewayToken?: string
): Promise<string> {
  if (signal?.aborted) throw new Error("Model request was cancelled.");
  if (!settings.baseUrl.trim() || !settings.model.trim()) {
    throw new Error("Configure the provider URL and model first.");
  }

  const prepared = prepareConversationRequest(
    messages.map(({ role, content }) => ({ role, content })),
    knowledgeContext
  );
  const requestMessages: ModelMessage[] = prepared.messages;

  if (!isTauri()) {
    if (settings.baseUrl !== "/api/gemini") {
      throw new Error("Browser preview supports Gemini through the secured Vercel proxy only. Select “Use Gemini on Vercel” in provider settings.");
    }
    if (!gatewayToken?.trim()) throw new Error("Enter the NEXUS access token from Vercel settings. This is separate from your Gemini API key.");
    const systemMessage = requestMessages.find(message => message.role === "system");
    let turns = requestMessages.filter(message => message.role !== "system").slice(-40);
    if (turns.some(message => message.content.length > 12_000)) {
      throw new Error("A chat message exceeds the Gemini proxy's 12,000-character per-message limit. Shorten the latest message and try again.");
    }
    const systemInstruction = systemMessage
      ? new TextDecoder().decode(new TextEncoder().encode(systemMessage.content).slice(0, 24_000))
      : "";
    const payload: Record<string, unknown> = {
      model: settings.model,
      messages: turns,
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(generation?.temperature !== undefined ? { temperature: generation.temperature } : {}),
      ...(generation?.maxOutputTokens !== undefined ? { maxOutputTokens: generation.maxOutputTokens } : {})
    };
    // Keep the serialized request below the server's 64 KiB hard limit.
    while (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 60 * 1024 && turns.length > 1) {
      turns = turns.slice(1);
      payload.messages = turns;
    }
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 64 * 1024) {
      throw new Error("This request is too large for the Gemini proxy. Shorten the message or reduce attached context.");
    }
    const response = await fetch("/api/gemini", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayToken.trim()}`
      },
      body: JSON.stringify(payload),
      signal
    });
    const payload = await response.json().catch(() => ({})) as {
      text?: string;
      usage?: { inputTokens?: number | null; outputTokens?: number | null };
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error || `Gemini proxy request failed (HTTP ${response.status}).`);
    if (typeof payload.text !== "string" || !payload.text.trim()) throw new Error("Gemini returned an empty response.");
    onUsage?.({
      ...(typeof payload.usage?.inputTokens === "number" ? { inputTokens: payload.usage.inputTokens } : {}),
      ...(typeof payload.usage?.outputTokens === "number" ? { outputTokens: payload.usage.outputTokens } : {})
    });
    onDelta?.(payload.text);
    return payload.text;
  }

  const router = createTauriModelRouter(settings);
  if (!router) throw new Error("The native model runtime is unavailable.");
  let answer = "";
  let receivedCompletion = false;
  for await (const event of router.stream(NATIVE_MODEL_PROVIDER_ID, {
    model: settings.model,
    messages: requestMessages,
    ...(generation?.temperature !== undefined ? { temperature: generation.temperature } : {}),
    ...(generation?.maxOutputTokens !== undefined ? { maxOutputTokens: generation.maxOutputTokens } : {}),
    signal
  })) {
    if (event.type === "text_delta") {
      answer += event.text;
      onDelta?.(event.text);
    } else if (event.type === "usage") {
      onUsage?.({ inputTokens: event.inputTokens, outputTokens: event.outputTokens });
    } else if (event.type === "completed") {
      receivedCompletion = true;
    }
  }

  if (signal?.aborted) throw new Error("Model request was cancelled.");
  if (!receivedCompletion) throw new Error("Provider stream ended without a completion event.");
  if (!answer.trim()) throw new Error("Provider returned an empty streaming response.");
  return answer;
}


export interface ProviderGenerationCheck {
  response: string;
  usage: { inputTokens?: number; outputTokens?: number } | null;
}

/** Sends a small, context-free prompt to verify actual generation, not just /models reachability. */
export async function testProviderGeneration(
  settings: ProviderSettings,
  signal?: AbortSignal,
  gatewayToken?: string
): Promise<ProviderGenerationCheck> {
  const usage: { value: ProviderGenerationCheck["usage"] } = { value: null };
  const response = await sendMessage(
    settings,
    [{
      id: "nexus-provider-health-check",
      role: "user",
      content: "Reply with exactly NEXUS_OK and nothing else.",
      createdAt: Date.now()
    }],
    "",
    undefined,
    signal,
    value => { usage.value = value; },
    { temperature: 0, maxOutputTokens: 16 },
    gatewayToken
  );
  return { response, usage: usage.value };
}
