# NEXUS AU — Threat Model and Permission Matrix

Status: initial design baseline, not a completed security audit.
Scope: current React/Vite + Tauri/Rust desktop foundation and planned local-first AI modules.
Last reviewed: 2026-11-08.

## 1. Security objectives

1. Provider credentials and local user data must not leak to browser code, logs, tool output, or other users.
2. Agents and tools operate with least privilege and cannot silently expand permissions.
3. Untrusted model output, retrieved documents, MCP metadata, and tool results are treated as data, never as trusted instructions.
4. Long-running work is bounded, cancellable, observable, and recoverable without replaying arbitrary code.
5. User-visible external side effects require explicit authorization.

## 2. Assets

| Asset | Impact if compromised |
|---|---|
| Provider API keys and OAuth tokens | Account abuse, financial loss, data exposure |
| Conversations and memories | Privacy loss and incorrect personalization |
| Imported documents and files | Privacy loss, prompt injection, data exfiltration |
| Agent checkpoints and audit events | Corrupted task state, misleading history |
| Tool permissions and integration settings | Unauthorized actions |
| Application updates and build pipeline | Supply-chain compromise |

## 3. Trust boundaries

- **UI boundary:** React is not a secret store. Browser storage is readable by same-origin script and is not encrypted credential storage.
- **Application boundary:** core services validate inputs and orchestrate work but do not grant host capabilities directly.
- **Provider boundary:** model requests and responses cross a network boundary; responses are untrusted.
- **Tool boundary:** Tool Gateway validates input, checks permission, bounds execution, and records audit events.
- **Desktop boundary:** Tauri commands are privileged. Only narrow commands with validated arguments should be exposed.
- **Persistence boundary:** LocalStorage is preview-only for sensitive state; desktop production storage must use SQLite migrations and OS-backed secret storage where appropriate.

## 4. Threats and required controls

| Threat | Example | Required control | Current status |
|---|---|---|---|
| Prompt injection | A document tells an agent to reveal secrets | Treat retrieved content as untrusted; separate policy from data; tool allowlists | Design requirement; end-to-end tests pending |
| Credential exposure | API key stored in localStorage or logged | OS credential vault / server-side proxy; redact logs; no secrets in frontend | Not implemented |
| Privilege escalation | Agent requests shell or filesystem access | Default-deny permission service; per-action approval; no raw host APIs in agents | Core gateway foundation exists |
| Tool abuse | Malformed or oversized tool arguments | Schema validation, 64 KB bounds, timeout, cancellation | Gateway foundation implemented |
| Audit tampering/loss | Tool executes but audit completion fails | Persist start before side effect; idempotency keys; uncertain outcome state | Local preview sink and explicit uncertain-outcome error implemented; production transactional store and reconciliation pending |
| State corruption | Stale agent overwrites newer checkpoint | Versioned schema, monotonic sequence, compare-and-swap | Checkpoint foundation implemented; runtime wiring pending |
| Malicious plugin/MCP server | Tool metadata or response contains hostile instructions | Per-server trust, per-tool approval, isolation, output limits | Not implemented |
| Supply-chain compromise | Vulnerable dependency or compromised action | Lockfile, dependency review, pinned actions, audit and update policy | Partial; dependency audit currently reports 6 advisories |
| Web content abuse | Browser agent visits untrusted URL | Domain policy, navigation restrictions, isolated browser context | Not implemented |
| Local data theft | Device/browser profile is compromised | Minimize secrets, OS keychain, encrypted backup, explicit export | Not implemented |

## 5. Permission matrix

Default is **deny**. Permissions are scoped to the requesting actor and resource. A broad permission must not imply a more powerful one.

| Capability | Default | Approval policy |
|---|---|---|
| Read current conversation context | Deny until granted to agent | Per agent/run |
| Read approved memory | Deny until granted | Per agent/run |
| Write or delete memory | Deny | Explicit user confirmation |
| Read user-selected file | Deny | Per selected file/session |
| Write or delete file | Deny | Explicit action-level approval |
| Browser read/navigation | Deny | Per domain/session |
| Browser interaction/submission | Deny | Explicit approval before side effect |
| GitHub read | Deny | Per repository |
| GitHub write/merge/release | Deny | Explicit action-level approval |
| Shell/process execution | Deny | Not exposed in current runtime; future sandbox only |
| MCP server connection | Deny | Per server, then per tool |
| OS notifications | Deny | User-configured opt-in |
| Microphone/audio capture | Deny | Visible push-to-talk / active capture indicator |

## 6. Operational invariants

- Permission service errors fail closed.
- Tool execution cannot begin until its audit-start event is persisted.\n- If execution succeeds but completion-audit persistence fails, callers receive a non-retryable uncertain-outcome error and must not replay the side effect automatically.
- Tool and agent inputs/outputs are size-limited and validated.
- Cancellation and timeout must stop waiting callers even if a worker does not cooperate; the underlying worker may still need isolation to guarantee termination.
- Never replay a generator or model request after restart unless its state transition is explicitly serializable and idempotent.
- Never place provider secrets in prompts, telemetry, frontend localStorage, or error messages.
- Do not enable shell, arbitrary filesystem access, or unrestricted browser automation as a default capability.
- Do not claim encryption, sandboxing, or secure credential storage until verified in the native implementation.

## 7. Known gaps and next controls

1. Replace the LocalStorage preview audit adapter with a transactional native store; add reconciliation and operation-level idempotency for uncertain side effects.
2. Implement an approval request store and resume flow with one-time, run-bound approval tokens.
3. Integrate checkpoints into a serializable step-based agent runtime; do not attempt to serialize async-generator internals.
4. Add Tauri command allowlists, argument validation, CSP review, and native build verification.
5. Add OS keychain integration and remove any temptation to store provider secrets in browser storage.
6. Add dependency audit triage; do not apply force upgrades without reviewing breaking changes.
7. Add adversarial tests for prompt injection, tool output spoofing, path traversal, permission races, and cancellation.

## 8. Review checklist for every new capability

- What data can it read, write, transmit, or delete?
- Which trust boundary does it cross?
- What is the narrowest permission scope?
- Can it cause an external side effect?
- Is approval required immediately before that side effect?
- Are inputs and outputs schema-validated and bounded?
- Can it be cancelled and audited?
- What happens if execution succeeds but audit persistence fails?
- What happens after restart?
- Are secrets excluded from UI, storage, telemetry, and logs?
