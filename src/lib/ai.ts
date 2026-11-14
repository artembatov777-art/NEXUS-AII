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
  generation?: { temperature?: number; maxOutputTokens?: number }
): Promise<string> {
  if (!isTauri()) {
    return "Browser preview mode is active. The NEXUS AU interface and local conversation history work here, but AI requests need the native Tauri backend. Open the desktop app to connect your provider securely. No API key was sent or stored by this preview.";
  }
  if (signal?.aborted) throw new Error("Model request was cancelled.");
  if (!settings.baseUrl.trim() || !settings.model.trim()) {
    throw new Error("Configure the provider URL and model first.");
  }

  const prepared = prepareConversationRequest(
    messages.map(({ role, content }) => ({ role, content })),
    knowledgeContext
  );
  const requestMessages: ModelMessage[] = prepared.messages;

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
  signal?: AbortSignal
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
    { temperature: 0, maxOutputTokens: 16 }
  );
  return { response, usage: usage.value };
}
