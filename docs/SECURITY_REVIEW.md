# NEXUS AU security review

**Review date:** 2026-11-13  
**Scope:** source-level review of the native Tauri host, React webview, provider transport, MCP transport, agent execution, SQLite persistence, backup/restore, and browser preview. This is an engineering review, not an independent penetration test or formal security certification.

## Trust boundaries

1. **Webview to native host.** The React UI can invoke the app's registered Tauri commands. Native commands validate inputs and keep provider credentials inside the Rust process.
2. **Native host to AI provider.** The endpoint is user-configured. Provider requests use HTTPS, except HTTP on loopback only. Redirects are disabled.
3. **Native host to MCP server.** MCP endpoints are user-configured and treated as untrusted. Remote metadata and tool results are bounded and validated before registration or handoff.
4. **Agent to tools.** Agents cannot call arbitrary host APIs. Execution passes through the Tool Gateway and its permission policy.
5. **Persistence.** Native workspace data is stored in SQLite. Browser preview data and semantic vectors are stored in localStorage/IndexedDB.

## Controls verified in code

### Credentials and provider requests

- The supported credential handles are `default` (backward-compatible OmniRoute profile) and `ollama` (separate Ollama API-key profile); the no-key profile is restricted to loopback endpoints. The webview never receives a previously stored secret.
- Provider keys are written to the OS credential vault, not SQLite, localStorage, workspace backups, or agent checkpoints.
- provider_vault_status distinguishes available, missing, and unavailable. The UI explains vault failure and does not fall back to plaintext storage.
- Provider URL validation requires HTTPS except for loopback HTTP, rejects embedded credentials/query/fragment, disables redirects, validates message roles and request size, and caps response bodies at 2 MB.
- Provider keys are redacted from provider error excerpts.
- Two fixed credential profiles are supported. Arbitrary multi-account profiles, automated key rotation, and recovery UX are not implemented.

### Agent and tool execution

- The runtime defaults to deny when no host permission policy is configured.
- Agent permissions and tool permissions are checked separately.
- The Tool Gateway validates tool inputs, applies timeouts/cancellation, bounds output, and records audit events.
- The model-planned workflow receives relevant profile memory and selected project knowledge as a separate, bounded reference field explicitly marked untrusted by the planner system prompt. The workflow is restricted to the approved workspace tool set and discovered MCP tools. Workspace reads/writes remain scoped to owner-approved roots. Every MCP tool call is high-risk and requires a separate native confirmation that displays the server/tool identity and a bounded input preview; external servers may process that input. The gateway also checks durable audit history and blocks replay of a previously started or terminal run/step rather than risking duplicate external side effects. Shell execution and arbitrary host APIs remain unavailable.
- Coordinator plans, delegated JSON outputs, step counts, dependencies, and serialized payload sizes are bounded.
- Approval grants are one-time and in-memory; they must be re-issued after restart.

### MCP

- HTTP transport omits ambient credentials, rejects redirects and dangerous header overrides, supports MCP session/protocol headers and best-effort session deletion, and bounds response streaming to 2 MB.
- SSE parsing is correlated to the request ID and limits event size/count.
- Server protocol version and capabilities are checked; initialization notification, paginated discovery, health checks, disconnect cleanup, and reconnect with a fresh transport are implemented.
- Remote tool schemas use a bounded JSON-Schema subset. Unsupported keywords, unsafe object keys, malformed metadata, duplicate tool names, and oversized results are rejected.
- MCP authentication and OAuth/bearer-token configuration are not implemented in this build; configured endpoints must be usable without authentication. A user must still trust the endpoint they configure. There is no provider-domain allowlist or certificate pinning.

### Storage and backups

- SQLite schema migrations run in one exclusive transaction. Workspace backup import is transactional and has rollback tests.
- Project deletion uses native database cleanup/cascade behavior and clears project-scoped semantic vectors.
- Tool audit and trace history have bounded retention; trace attributes are redacted and bounded. Owner-initiated filesystem reads, content searches, creates, edits, renames, moves, and permission changes also create native audit events without including private paths.
- Provider credentials are excluded from backups.
- SQLite files, browser localStorage/IndexedDB, agent checkpoints, and exported workspace backups are **not application-level encrypted**. Protect the OS account and device storage; treat exported backups as sensitive files.

### Webview policy

The Tauri CSP sets default-src self, base-uri self, object-src none, form-action self, and frame-src none. connect-src permits HTTPS and loopback HTTP because users configure compatible provider/MCP endpoints. Inline styles remain enabled for the current UI.

## OmniRoute cloud gateway boundary

- Cloud model requests use the configured OmniRoute `/v1` endpoint; provider-specific cloud credentials are held by OmniRoute, while the NEXUS-to-OmniRoute endpoint key is stored only in the OS credential vault.
- A local OmniRoute endpoint may use loopback HTTP. Any non-loopback endpoint must use HTTPS. Redirects remain disabled and URL user-info/query/fragment components are rejected by the native provider transport.
- Model IDs are selected from the gateway's model catalog; model/provider capabilities are not assumed to be uniform.
- Conversation and selected context content leave the device when a cloud model is selected. The UI must disclose the active remote route and never silently switch a local request to a cloud provider.
- NEXUS uses only the public inference surface needed by the app. Administrative dashboard and provider-management endpoints are not exposed to agents or tools.

## Platform credential behavior

- **Windows:** keyring crate uses the platform credential store (Windows Credential Manager backend).
- **macOS:** keyring crate uses Keychain.
- **Linux:** keyring crate requires a working Secret Service-compatible keyring, commonly provided by the desktop session. Headless Linux environments may report unavailable.
- CI compiles the native application on Windows, macOS, and Linux. CI cannot prove that an interactive desktop keyring is unlocked or usable for a real signed-in user. Manual smoke tests on each OS are still required before a production release.

## Known limitations and residual risk

- The native provider path supports bounded SSE streaming and cancellation. A provider may still ignore cancellation after a request has reached its own infrastructure; the native host enforces request and stream bounds.
- The configured provider and MCP endpoints are user-controlled. HTTPS is required for non-loopback provider requests, but there is no host allowlist.
- SQLite, browser stores, checkpoints, and backup files rely on OS-level account/disk protection rather than app-level encryption.
- The semantic vector index is stored in IndexedDB. It is reconciled against SQLite knowledge records on startup/restore and rebuilt in bounded batches, but embeddings are not stored in native SQLite.
- Browser preview intentionally uses localStorage and is not a secure multi-user environment.
- Voice services depend on the OS/browser WebView and may send audio to a platform speech service; NEXUS AU does not provide a native offline speech engine.
- Unrestricted desktop automation, filesystem access outside owner-approved roots, general shell execution, and notification workflows are not implemented. The File System module supports bounded read/write/create/search/rename/move operations only within explicitly approved roots.
- The CI pipeline builds the Tauri app and runs native SQLite integration tests on three OS runners, but it does not automate GUI interaction with a real logged-in desktop session.
- The frontend Quality workflow includes `npm audit --audit-level=high`; each latest run must be reviewed and applicable advisories remediated. An independent penetration test is not part of this review.

## Release checklist

- [ ] Manually verify key save, status, use, and delete in Windows Credential Manager, macOS Keychain, and a Linux Secret Service desktop session.
- [ ] Verify OS account/disk encryption and backup handling on release machines.
- [ ] Run dependency audit and remediate applicable production dependency advisories.
- [ ] Add GUI automation once a supported WebDriver/desktop test runner is available for all target platforms.
- [ ] Complete independent security testing before exposing remote MCP or broader desktop automation capabilities.


## Model route disclosure

- Provider settings default to a remote route. The selected location is explicitly owner-declared and is not inferred from the OmniRoute gateway hostname.
- A loopback OmniRoute endpoint may still forward requests to a cloud provider. NEXUS cannot currently verify the gateway's downstream route or enforce local execution from the model ID alone.
- The UI marks a local declaration as unverified and warns the owner to verify OmniRoute routing before sending private context. Ollama can be used through its OpenAI-compatible loopback `/v1` endpoint when the Ollama service is installed and running. NEXUS does not install Ollama, download model weights, or manage its model lifecycle.
