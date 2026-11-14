# NEXUS AU — Threat Model and Permission Matrix

Status: initial design baseline, not a completed security audit.
Scope: current React/Vite + Tauri/Rust desktop foundation and planned local-first AI modules.
Last reviewed: 2026-11-14.

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
| Prompt injection | A document tells an agent to reveal secrets | Treat retrieved content as untrusted; separate policy from data; tool allowlists | Chat context and agent-planner reference context are separately marked untrusted; planner tools are allowlisted and permission-gated. Adversarial end-to-end prompt-injection tests remain open. |
| Credential exposure | API key stored in localStorage or logged | OS credential vault / server-side proxy; redact logs; no secrets in frontend | Native OS credential vault is implemented for desktop provider keys; hosted web still requires a server-side proxy. Trace persistence now drops unknown top-level fields and filters sensitive attribute names; callers must still keep secret values out of telemetry. |
| Privilege escalation | Agent requests shell or filesystem access | Default-deny permission service; per-action approval; no raw host APIs in agents | Core gateway foundation exists |
| Tool abuse | Malformed or oversized tool arguments | Schema validation, 64 KB bounds, timeout, cancellation | Gateway validation, bounds, timeout, cancellation, and audit lifecycle are implemented; broader adversarial testing remains open. |
| Audit tampering/loss | Tool executes but audit completion fails | Persist start before side effect; idempotency keys; uncertain outcome state | Native transactional SQLite audit/trace persistence and retention caps are implemented. The gateway checks prior audit records for the same run/step and blocks blind replay. Owner-confirmed manual reconciliation is implemented; automatic input-bound result replay remains pending. |
| State corruption | Stale agent overwrites newer checkpoint | Versioned schema, monotonic sequence, compare-and-swap | Versioned checkpoints use native SQLite persistence with transactional compare-and-swap; approval grants remain ephemeral by design and must be re-issued after restart. |
| Malicious plugin/MCP server | Tool metadata or response contains hostile instructions | Per-server trust, per-tool approval, isolation, output limits | Session-aware HTTP transport, bounded metadata/schema/output, HTTPS-or-loopback-only endpoints, and per-call approval with input preview are implemented. OAuth/bearer authentication, domain allowlists, and adversarial live-server tests remain open. |
| Supply-chain compromise | Vulnerable dependency or compromised action | Lockfile, dependency review, pinned actions, audit and update policy | A Rust `Cargo.lock` is committed and the native workflow includes `cargo audit`; frontend Quality includes `npm audit --audit-level=high`. The last recorded zero-vulnerability npm result is tied to an older baseline, and the current branch-head workflow results still need verification. GitHub Actions are version-tagged rather than pinned to immutable SHAs. |
| Web content abuse | Browser agent visits untrusted URL | Domain policy, navigation restrictions, isolated browser context | Not implemented |
| Local data theft | Device/browser profile is compromised | Minimize secrets, OS keychain, encrypted backup, explicit export | Not implemented |

## 5. Permission matrix

Default is **deny**. Permissions are scoped to the requesting actor and resource. A broad permission must not imply a more powerful one.

| Capability | Default | Approval policy |
|---|---|---|
| Read current conversation context | Deny until granted to agent | Per agent/run |
| Read approved memory | Deny until granted | Bounded profile/project context is retrieved only after the owner confirms AI planning; retrieved text remains untrusted data. |
| Write or delete memory | Deny | Explicit user confirmation |
| Read user-selected file | Deny | Per selected file/session |
| Write or delete file | Deny | Explicit action-level approval |
| Browser read/navigation | Deny | Per domain/session |
| Browser interaction/submission | Deny | Explicit approval before side effect |
| GitHub read | Deny | Per repository |
| GitHub write/merge/release | Deny | Explicit action-level approval |
| Shell/process execution | Deny | Not exposed in current runtime; future sandbox only |
| MCP server connection | Deny | Owner explicitly configures and connects a trusted unauthenticated endpoint; each tool call requires separate approval |
| OS notifications | Deny | User-configured opt-in |
| Microphone/audio capture | No background capture; user action required | Push-to-talk only; host/browser permission applies, and recognition may be processed by a browser-provided service |

## 6. Operational invariants

- Permission service errors fail closed.
- Tool execution cannot begin until its audit-start event is persisted.
- If execution succeeds but completion-audit persistence fails, callers receive a non-retryable uncertain-outcome error and must not replay the side effect automatically.
- Tool and agent inputs/outputs are size-limited and validated.
- Cancellation and timeout must stop waiting callers even if a worker does not cooperate; the underlying worker may still need isolation to guarantee termination.
- Never replay a generator or model request after restart unless its state transition is explicitly serializable and idempotent.
- Never place provider secrets in prompts, telemetry, frontend localStorage, or error messages. Native trace persistence reconstructs events from allowlisted fields and filters sensitive attribute names; a benign attribute name can still carry a secret value, so callers must never put credentials in trace attributes.
- Do not enable shell, arbitrary filesystem access, or unrestricted browser automation as a default capability.
- Do not claim encryption, sandboxing, or secure credential storage until verified in the native implementation.

## 7. Known gaps and next controls

1. Add automatic input-bound result replay for eligible deterministic operations; native audit-led replay protection and owner-confirmed manual reconciliation currently prevent blind re-execution of uncertain external side effects.
2. Add a user-facing approval queue and durable native approval state. The core currently supports ephemeral, one-time, run/agent/permission-bound grants; restart requires re-approval.
3. Add operation-level idempotency and a durable event outbox to the serializable step-based agent runtime; do not attempt to serialize async-generator internals.
4. Continue Tauri capability/CSP review and add adversarial path, permission-race, and command-boundary tests; command argument validation and cross-platform native CI are implemented.
5. Complete manual OS keychain lifecycle smoke tests on real Windows, macOS, and Linux desktop sessions; provider keys already use platform credential-vault adapters.
6. Keep the committed Rust `Cargo.lock`, native `cargo audit`, and frontend npm audit green; inspect the current branch-head results and do not apply force upgrades without reviewing breaking changes.
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
