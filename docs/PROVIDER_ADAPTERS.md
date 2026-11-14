# Provider adapter contract

NEXUS uses a provider-neutral `ModelRouter`. The active native adapter connects directly to configured OpenAI-compatible endpoints. No aggregator or gateway is required by the AI Core.

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

## Deferred gateway integration

No OmniRoute-specific profile builder, adapter, or live connection is implemented. A gateway may be evaluated only during final integration if the owner explicitly chooses it. Core local and direct-cloud operation must remain fully functional without a gateway.
