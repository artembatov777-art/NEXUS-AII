# NEXUS AU — Provider compatibility

## Current adapter contract

The native desktop host implements two explicit protocol adapters:

- **OpenAI Chat Completions:** `GET {baseUrl}/models`, `POST {baseUrl}/chat/completions`, bearer-token authentication. Browser preview uses one secured Railway route (`/api/provider/:provider`) for OpenAI, Gemini, DeepSeek, Mistral, xAI/Grok, Groq, OpenRouter, SambaNova, NVIDIA, and owner-configured OmniRoute. Provider API keys are read only from Railway environment variables.
- **Anthropic Messages:** `GET {baseUrl}/models`, `POST {baseUrl}/messages`, `x-api-key` plus `anthropic-version` headers, Anthropic typed SSE parsing.

Both adapters use bounded responses, no redirects, HTTPS for remote endpoints, HTTP only for loopback hosts, and OS credential-vault handles.

A built-in preset only fills a documented endpoint. It does not validate a user's API key, guarantee account access, guarantee a model is enabled, or start a network request. The owner must save a key in the OS vault, load the provider's live model catalog, and run a generation test.

## Built-in provider presets

| Provider | Base URL | Adapter status |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | Preset available; live account verification required |
| Google Gemini API | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI-compatible endpoint preset; live verification required |
| DeepSeek | `https://api.deepseek.com` | OpenAI-compatible endpoint preset; live verification required |
| Mistral AI | `https://api.mistral.ai/v1` | OpenAI-compatible endpoint preset; live verification required |
| xAI / Grok | `https://api.x.ai/v1` | OpenAI-compatible endpoint preset; live verification required |
| Groq | `https://api.groq.com/openai/v1` | OpenAI-compatible endpoint preset; live verification required |
| OpenRouter | `https://openrouter.ai/api/v1` | OpenAI-compatible endpoint preset; live verification required |
| SambaNova | `https://api.sambanova.ai/v1` | OpenAI-compatible endpoint preset; live verification required |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | OpenAI-compatible endpoint preset; live verification required |
| OmniRoute | Owner-configured public HTTPS `/v1` endpoint | Hosted through Railway gateway; endpoint and key required |
| Anthropic Claude | `https://api.anthropic.com/v1` | Native Messages adapter; model discovery and streaming implemented, live verification required |
| Ollama | `http://127.0.0.1:11434/v1` | Existing local OpenAI-compatible profile; owner must run Ollama |

The presets are convenience configuration, not provider-specific feature adapters. `NEXUS Public` is the public NEXUS deployment identity/URL, not an upstream model provider or a separate API-key slot. Capabilities such as tools, image input, JSON mode, reasoning controls, and image generation must be declared and tested separately; NEXUS must not infer them from a model name.

## Protocol adapters

Anthropic Claude is implemented as a separate native Messages adapter, not as an OpenAI-compatible URL alias. It uses the Anthropic model catalog, `x-api-key` and `anthropic-version` headers, the Messages request shape (including the separate system instruction and required max token count), and typed SSE events for text, usage, and completion. Automated Rust parser tests and TypeScript IPC adapter tests cover the protocol mapping. Live API verification still requires the owner's own Claude API key.

Other providers that issue API keys are not automatically compatible. They need either an OpenAI-compatible endpoint or a dedicated protocol adapter.

## Profile and routing behavior

- Multiple provider profiles are registered in one provider-neutral router and their model catalogs are discovered concurrently.
- Automatic routing classifies the latest user request into coding, analysis, research, creative, or general work and orders eligible providers using deterministic default preferences.
- Manual mode restricts requests to the currently selected provider profile.
- Automatic mode is restricted to profiles with the same owner-declared inference location as the active profile. It does not silently cross from a declared local route to remote cloud profiles or vice versa.
- Safe failover is allowed only for retryable failures that occur before the first user-visible text delta. Once output has started, NEXUS never silently switches models and risks duplicating or contradicting the answer.
- Task classification and default provider ordering are heuristics, not benchmark claims. Provider order should be owner-configurable in a later routing policy editor.
- Browser preview is isolated and does not accept arbitrary provider keys. Supported cloud providers use the secured Railway AI Gateway with a separate NEXUS access token; provider keys never enter browser storage or requests. Gemini text requests use its OpenAI-compatible endpoint through the same provider route. Gemini image generation remains a dedicated server-side image endpoint.
- API keys are never stored in browser profile records or workspace backups. Native desktop requests pass only the credential handle to Rust; Rust retrieves the secret from the OS credential vault.

## Release verification still required

- Verify model discovery and streaming generation with owner-provided test credentials for each provider.
- Verify per-profile key isolation, replacement, deletion, and vault failure handling on Windows, macOS, and Linux.
- Live-test Claude model discovery, generation, usage reporting, and cancellation with an owner-provided API key.
- Add owner-editable provider priority, task preferences, and cost-aware routing after the initial deterministic routing policy is validated.
