# Provider adapter preparation

NEXUS uses a provider-neutral `ModelRouter`. The native OpenAI-compatible adapter can register multiple independent endpoint profiles through `createTauriModelRouterForProfiles`.

## Current adapter contract

Each profile supplies a stable router ID and the existing `ProviderSettings` shape:

- `baseUrl`: HTTPS for remote endpoints; HTTP is accepted only for loopback addresses
- `model`: exact model ID returned by that endpoint
- `inferenceLocation`: owner-declared `local` or `remote`; it is not independently verified
- `credentialHandle`: OS-vault profile name, or `none` for loopback-only no-key runtimes

Credentials are passed to the native Rust host as a vault handle. They are never copied into frontend model objects or persisted provider profile JSON.

## Future endpoint profiles (prepared, not connected)

| Profile ID | Intended endpoint | Credential mode | State |
|---|---|---|---|
| `nexus.ollama` | `http://127.0.0.1:11434/v1` | `none` | Adapter-compatible; not installed or started |
| `nexus.omniroute` | User-configured HTTPS gateway URL, or HTTP loopback endpoint | OS credential vault | Adapter-compatible; not configured or connected |
| `nexus.native-provider` | Current active endpoint from Settings | Existing vault profile | Current single-endpoint UI |

The multi-profile factory performs no network request. A provider is contacted only when the caller explicitly runs model discovery or inference. No background connection, installation, process launch, or gateway dependency is introduced.

## Security and limitations

- Remote endpoints require HTTPS. Plain HTTP is accepted only for localhost/loopback, including a locally hosted OmniRoute instance.
- Redirects are disabled in the native HTTP client.
- URL credentials, query parameters, and fragments are rejected.
- `inferenceLocation` is an owner disclosure, not proof of where an upstream gateway executes inference.
- This adapter supports the bounded OpenAI-compatible chat-completions and model-catalog contract. Provider-specific features must be declared and tested before use.
- The Settings screen still selects one active endpoint. Multi-profile registration is a core capability for the next provider-management UI; this document does not claim that profile management UI is complete.
