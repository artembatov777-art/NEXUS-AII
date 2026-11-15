# NEXUS AU — Provider compatibility

## Current adapter contract

The native desktop host implements the OpenAI Chat Completions protocol for compatible providers. Browser preview uses one secured Railway route (`/api/provider/:provider`) for the three supported hosted providers: Gemini, DeepSeek and NVIDIA. Provider API keys are read only from Railway environment variables.

The native host also retains the Anthropic Messages protocol adapter for compatibility with existing custom profiles, but Anthropic is no longer offered as a built-in provider preset or accepted by the hosted Railway gateway.

Both adapters use bounded responses, no redirects, HTTPS for remote endpoints, HTTP only for loopback hosts, and OS credential-vault handles.

A built-in preset only fills a documented endpoint. It does not validate a user's API key, guarantee account access, guarantee a model is enabled, or start a network request. The owner must save a key in the OS vault or deployment environment, load the provider's live model catalog, and run a generation test.

## Built-in provider presets

| Provider | Base URL | Adapter status |
|---|---|---|
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI-compatible endpoint preset; live verification required |
| DeepSeek | `https://api.deepseek.com` | OpenAI-compatible endpoint preset; live verification required |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | OpenAI-compatible endpoint preset; live verification required |
| Ollama | `http://127.0.0.1:11434/v1` | Existing local OpenAI-compatible profile; owner must run Ollama |

The browser-hosted selector exposes Gemini, DeepSeek and NVIDIA only. Ollama remains a separate local no-key option. Custom native provider profiles remain possible for advanced owner-managed endpoints. The presets are convenience configuration, not provider-specific feature adapters. `NEXUS Public` is the public NEXUS deployment identity/URL, not an upstream model provider or a separate API-key slot. Capabilities such as tools, image input, JSON mode, reasoning controls, and image generation must be declared and tested separately; NEXUS must not infer them from a model name.

## Protocol adapters

The native Anthropic Messages adapter remains available to legacy/custom native profiles, but it is not part of the built-in provider choices or hosted Railway allowlist. Other providers that issue API keys are not automatically compatible. They need either an OpenAI-compatible endpoint or a dedicated protocol adapter.

## Profile and routing behavior

- Multiple provider profiles are registered in one provider-neutral router and their model catalogs are discovered concurrently.
- Automatic routing classifies the latest user request into coding, analysis, research, creative, or general work and orders eligible providers using deterministic default preferences.
- Manual mode restricts requests to the currently selected provider profile.
- Automatic mode is restricted to profiles with the same owner-declared inference location as the active profile. It does not silently cross from a declared local route to remote cloud profiles or vice versa.
- Safe failover is allowed only for retryable failures that occur before the first user-visible text delta. Once output has started, NEXUS never silently switches models and risks duplicating or contradicting the answer.
- Task classification and default provider ordering are heuristics, not benchmark claims. Provider order should be owner-configurable in a later routing policy editor.
- Browser preview is isolated and does not accept arbitrary provider keys. Gemini, DeepSeek and NVIDIA use the secured Railway AI Gateway with a separate NEXUS access token; provider keys never enter browser storage or requests. Gemini image generation remains a dedicated server-side image endpoint.
- API keys are never stored in browser profile records or workspace backups. Native desktop requests pass only the credential handle to Rust; Rust retrieves the secret from the OS credential vault.

## Release verification still required

- Verify model discovery and streaming generation with owner-provided test credentials for Gemini, DeepSeek and NVIDIA.
- Verify per-profile key isolation, replacement, deletion, and vault failure handling on Windows, macOS, and Linux.
- Verify Gemini image generation through its separate server-side endpoint.
- Add owner-editable provider priority, task preferences, and cost-aware routing after the initial deterministic routing policy is validated.
