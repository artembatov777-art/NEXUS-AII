# Provider adapter contract

NEXUS uses a provider-neutral `ModelRouter`. The native desktop adapter connects directly to configured endpoints and retrieves keys from the OS credential vault. Browser preview uses a separate secured Railway AI Gateway so provider keys remain server-side.

## Current routes

| Profile | Endpoint | Credential mode | Runtime behavior |
|---|---|---|---|
| `nexus.native-provider` | Owner-configured compatible endpoint | OS credential vault or loopback-only no-key | Active Settings/chat route |
| `nexus.ollama` | `http://127.0.0.1:11434/v1` | No key | Prepared locally; not installed or started by NEXUS |
| Additional saved profiles | Owner-configured HTTPS compatible endpoints | Dedicated OS-vault entry per saved cloud profile | Saved without connecting; explicit discovery or inference is required |

The generic `createTauriModelRouterForProfiles` factory can register multiple direct compatible endpoints without contacting them. The current chat UI selects one active profile at a time. Saving or selecting a profile does not start a network request.

## Credential handles

- API keys are stored only in the platform credential vault.
- New saved cloud profiles receive a dedicated, randomly generated handle with a strict `profile-[32 lowercase hex]` format.
- The native host validates the handle before any keyring operation; arbitrary account names cannot be supplied through IPC.
- Legacy `default` and `ollama` handles remain as shared slots for existing configurations.
- `none` is accepted only for localhost/loopback endpoints.
- Deleting a profile also deletes its dedicated vault entry. Shared legacy keys are not deleted when one profile using them is removed.
- Profile JSON and workspace backups contain only endpoint/model/route/handle metadata, never the API key itself.

## Network and runtime rules

- Remote endpoints require HTTPS. Plain HTTP is accepted only for localhost/loopback.
- Redirects are disabled in the native HTTP client.
- URL credentials, query parameters, and fragments are rejected.
- `inferenceLocation` is an owner-declared disclosure, not proof of where an upstream service executes inference.
- The adapter supports bounded OpenAI-compatible model discovery and chat completions with streaming/cancellation. Provider-specific capabilities must be declared and tested before use.
- NEXUS does not install Ollama, download model weights, or manage provider process lifecycle in this baseline.

## Hosted Railway gateway

Browser preview routes OpenAI, Gemini, DeepSeek, Mistral, xAI/Grok, Groq, OpenRouter, SambaNova, NVIDIA, and owner-configured OmniRoute through `/api/provider/:provider`. Each provider has an explicit allowlisted upstream base URL and server-side environment key. The shared `NEXUS_API_TOKEN` authenticates the owner to the gateway; it is not an upstream provider key. Gemini image generation remains a separate server-side image endpoint. `NEXUS Public` identifies the public NEXUS deployment and is not an upstream model provider.
