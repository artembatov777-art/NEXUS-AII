# NEXUS AU — Provider compatibility

## Current adapter contract

The native desktop host currently implements the OpenAI Chat Completions wire format:
- model discovery: `GET {baseUrl}/models`
- streamed generation: `POST {baseUrl}/chat/completions`
- bearer-token authentication from an OS credential-vault handle
- bounded responses, no redirects, HTTPS for remote endpoints, and HTTP only for loopback hosts

A built-in preset only fills a documented endpoint. It does not validate a user's API key, guarantee account access, guarantee a model is enabled, or start a network request. The owner must save a key in the OS vault, load the provider's live model catalog, and run a generation test.

## Built-in OpenAI-compatible presets

| Provider | Base URL | Adapter status |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | Preset available; live account verification required |
| Google Gemini API | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI-compatible endpoint preset; live verification required |
| DeepSeek | `https://api.deepseek.com` | OpenAI-compatible endpoint preset; live verification required |
| Mistral AI | `https://api.mistral.ai/v1` | OpenAI-compatible endpoint preset; live verification required |
| xAI / Grok | `https://api.x.ai` | OpenAI-compatible endpoint preset; live verification required |
| Ollama | `http://127.0.0.1:11434/v1` | Existing local OpenAI-compatible profile; owner must run Ollama |

The presets are convenience configuration, not provider-specific feature adapters. Capabilities such as tools, image input, JSON mode, reasoning controls, and image generation must be declared and tested separately; NEXUS must not infer them from a model name.

## Explicitly not supported by this adapter

Anthropic Claude's native Messages API is a different protocol from the OpenAI Chat Completions API. A Claude API key and URL must not be presented as a supported preset until NEXUS has a dedicated Anthropic adapter with its own model discovery, request mapping, streaming parser, error normalization, cancellation, and tests.

Other providers that issue API keys are not automatically compatible. They need either an OpenAI-compatible endpoint or a dedicated protocol adapter.

## Profile and routing behavior

- Multiple provider profiles can be saved and switched manually.
- The current chat settings select one active provider endpoint at a time.
- Multi-provider simultaneous routing, automatic task-based model selection, and automatic failover are not yet implemented.
- Browser preview is isolated and does not accept arbitrary provider keys. Its supported remote route remains the secured Gemini Vercel proxy with a separate NEXUS access token.
- API keys are never stored in browser profile records or workspace backups. Native desktop requests pass only the credential handle to Rust; Rust retrieves the secret from the OS credential vault.

## Release verification still required

- Verify model discovery and streaming generation with owner-provided test credentials for each provider.
- Verify per-profile key isolation, replacement, deletion, and vault failure handling on Windows, macOS, and Linux.
- Add a dedicated Anthropic adapter before claiming native Claude API support.
- Add a multi-provider routing policy only after provider identity, capabilities, cost, privacy route, and failover semantics are explicit and testable.
