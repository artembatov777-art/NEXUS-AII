import type { ModelEvent, ModelRequest, ModelRouter } from "./model";

export type ModelTask = "coding" | "analysis" | "research" | "creative" | "general";
export interface ModelRouteCandidate {
  providerId: string;
  modelId: string;
  family: string;
}

const TASK_PATTERNS: Record<ModelTask, RegExp> = {
  coding: /\b(code|coding|debug|bug|typescript|javascript|python|rust|sql|api|function|script|программ|код|ошибк|баг|функци|скрипт)\b/i,
  research: /\b(research|sources|source|latest|current|compare prices|find information|найди|источник|исслед|актуальн|сравни цены|поищи)\b/i,
  creative: /\b(write a story|story|poem|creative|brainstorm| придумай|история|рассказ|стих|сценар|креатив|иде[яи])\b/i,
  analysis: /\b(analy[sz]e|analysis|reason|evaluate|explain|review|audit|разбер|анализ|объясни|оцени|проверь|сравни|почему)\b/i,
  general: /[\s\S]*/
};

export function classifyModelTask(messages: ModelRequest["messages"]): ModelTask {
  const text = ([...messages].reverse().find(message => message.role === "user")?.content ?? "").slice(0, 12_000).toLocaleLowerCase();
  if (/(\\b(code|coding|debug|bug|typescript|javascript|python|rust|sql|api|function|script)\\b|программ|код|ошибк|баг|функци|скрипт)/i.test(text)) return "coding";
  if (/(\\b(research|sources|source|latest|current|compare prices|find information)\\b|найди|источник|исслед|актуальн|сравни цены|поищи)/i.test(text)) return "research";
  if (/(\\b(write a story|story|poem|creative|brainstorm)\\b|придумай|история|рассказ|стих|сценар|креатив|иде[яи])/i.test(text)) return "creative";
  if (/(\\b(analy[sz]e|analysis|reason|evaluate|explain|review|audit)\\b|разбер|анализ|объясни|оцени|проверь|сравни|почему)/i.test(text)) return "analysis";
  return "general";
}

const FAMILY_PREFERENCE: Record<ModelTask, readonly string[]> = {
  coding: ["anthropic", "openai", "deepseek", "mistral", "xai", "gemini", "ollama", "other"],
  analysis: ["anthropic", "openai", "gemini", "deepseek", "mistral", "xai", "ollama", "other"],
  research: ["gemini", "openai", "anthropic", "deepseek", "mistral", "xai", "ollama", "other"],
  creative: ["gemini", "anthropic", "openai", "mistral", "xai", "deepseek", "ollama", "other"],
  general: ["gemini", "openai", "anthropic", "deepseek", "mistral", "xai", "ollama", "other"]
};

/** Deterministic default ordering. Owners can override it with an explicit preferred provider. */
export function orderModelRouteCandidates(
  candidates: ModelRouteCandidate[],
  task: ModelTask,
  preferredProviderId?: string
): ModelRouteCandidate[] {
  const familyOrder = FAMILY_PREFERENCE[task];
  return [...candidates].sort((a, b) => {
    const aPreferred = a.providerId === preferredProviderId ? -1 : 0;
    const bPreferred = b.providerId === preferredProviderId ? -1 : 0;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    const ai = familyOrder.indexOf(a.family);
    const bi = familyOrder.indexOf(b.family);
    const ar = ai < 0 ? familyOrder.length : ai;
    const br = bi < 0 ? familyOrder.length : bi;
    return ar - br || a.providerId.localeCompare(b.providerId);
  });
}

function isRetryableBeforeOutput(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const failure = cause as { retryable?: unknown; code?: unknown };
  if (failure.retryable === true) return true;
  return ["provider_unavailable", "network_error", "timeout", "rate_limited"].includes(String(failure.code ?? ""));
}

/**
 * Fail over only when the previous provider failed before returning any text.
 * Once user-visible text has streamed, retrying could duplicate or contradict it.
 */
export async function* streamWithModelFailover(
  router: ModelRouter,
  candidates: ModelRouteCandidate[],
  request: Omit<ModelRequest, "model">
): AsyncIterable<ModelEvent> {
  if (!candidates.length) throw new Error("No verified model route is available for this task.");
  const failures: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (request.signal?.aborted) throw new Error("Model request was cancelled.");
    const candidate = candidates[index];
    let emittedText = false;
    let completed = false;
    const buffered: ModelEvent[] = [];
    try {
      for await (const event of router.stream(candidate.providerId, { ...request, model: candidate.modelId })) {
        if (event.type === "text_delta") {
          if (!emittedText) {
            for (const pending of buffered) yield pending;
            buffered.length = 0;
          }
          emittedText = true;
          yield event;
        } else if (emittedText) {
          yield event;
        } else {
          buffered.push(event);
        }
        if (event.type === "completed") completed = true;
      }
      if (!completed) throw new Error("Provider ended without a completion event.");
      for (const pending of buffered) yield pending;
      return;
    } catch (cause) {
      if (request.signal?.aborted) throw new Error("Model request was cancelled.");
      const message = cause instanceof Error ? cause.message : "Provider request failed.";
      failures.push(candidate.providerId + "/" + candidate.modelId + ": " + message);
      if (emittedText || index === candidates.length - 1 || !isRetryableBeforeOutput(cause)) {
        throw new Error(failures.join("\n"));
      }
    }
  }
  throw new Error(failures.join("\n") || "No model route completed the request.");
}
