# Changelog

All notable NEXUS AU changes are recorded here. This project is under active development; entries describe implemented slices, not a claim that the full roadmap is complete.

## Unreleased

### Changed
- File editing now checks the opened content snapshot before saving, rejects external changes, preserves the user's draft, and offers an explicit reload of the latest version.
- File System navigation and close requests now guard unsaved edits instead of silently discarding them.
- Replaced the legacy `@xenova/transformers` v2 dependency with `@huggingface/transformers` v4.3.2 and the maintained ONNX Community MiniLM export; retained mean pooling and normalized embeddings while switching to the v4 q8 dtype option.
- Raised the Vite and Vitest minimum dependency ranges to patched releases after the latest Quality CI exposed dependency advisories.
- Added an injectable embedding extractor boundary so validation and vector conversion can be tested without downloading model weights.
- Added the explicit Rust `Vec<String>` type to the provider model catalog parser, fixing the cross-platform Rust inference error.
- Encrypted workspace backups now export schema v2 with AES-GCM authenticated metadata while retaining schema v1 import compatibility.
- Provider API keys are redacted from successful model output, including stream content split across multiple SSE deltas.
- Native project migration is coordinated across repository instances, and project mutations wait for migration completion.
- Knowledge imports now send incremental ID-based upserts instead of rewriting a potentially stale full snapshot.
- File move/rename source validation keeps the final path component unresolved to avoid following a substituted symlink target.
- Batch file renames now persist a SQLite recovery journal before mutation and automatically attempt safe rollback after an interrupted application session; ambiguous paths fail closed and are surfaced in the File System panel.

### Verification
- Commit `ae4276e`: frontend Quality passed with 52 test files / 311 tests; `npm audit --audit-level=high` reported 0 vulnerabilities.
- Commit `ae4276e`: Mobile Interface Preview build and deployment passed.
- Commit `ae4276e`: Native Windows/macOS/Linux matrix passed, including Rust tests and native executable builds. Subsequent conflict-snapshot and draft-recovery changes are not covered by that run and require fresh CI.
- Commit `f06625cdc9c3165e3ea4ca93f21ae69354135c0d`: fresh Frontend Quality passed with 69 test files / 485 tests, TypeScript/Vite production build, and npm audit reporting 0 vulnerabilities. Native cross-platform verification for this revision remains pending.

### Added
- Agent Control Center integrated into the workspace with a bounded local demo agent, explicit approval/rejection, run progress, cancellation, checkpoint history, and resume support.
- Resumable agent registry exposes metadata-only descriptors, and the Control Center displays registered agent limits plus checkpointed final preview output.
- Editable local agent profile with validated execution budgets, local persistence, and versioned runtime replacement; active/waiting runs block profile changes.
- Phase I Agent Control Center acceptance completed in browser-preview scope; CI run 42518677919 passed 13 test files / 61 tests and the Vite production build.
- Built-in local workflow agent invokes a non-destructive preview tool only through the Tool Gateway; its UI explicitly states that no LLM or external system is involved.
- Integration tests covering built-in agent approval, gateway invocation, audit events, persisted completion, and invalid input.
- Provider-neutral core contracts for conversations, model streaming, memory, bounded agents, and tool execution.
- User-confirmed memory records with provenance and deterministic local lexical retrieval.
- Bounded agent runtime with permission checks, cancellation, timeout, step budgets, and output limits.
- Permission-enforcing Tool Gateway with input/output limits and audit lifecycle port.
- LocalStorage preview audit sink with bounded append/list operations and stored-record validation.
- Explicit non-retryable error when a tool side effect completes but its completion audit cannot be persisted.
- Host-identity-bound bridge that lets resumable agent steps invoke tools only through the permission-enforcing Tool Gateway, covered by an integration test.
- Browser-preview composition root that wires checkpoint storage, audit storage, permission adapters, the Tool Gateway, agent bridge, one-time approval authority, and resumable runtime.
- End-to-end composition tests covering approval handoff, one-time grant consumption, host identity, tool permission checks, audit lifecycle, and checkpoint completion.
- Ephemeral one-time agent approval grants bound to run, agent, and exact permission; forged and replayed grants fail closed.
- Versioned agent checkpoint contract, compare-and-swap sequence protection, and LocalStorage preview adapter.
- Initial upstream research and architecture decisions for LangGraph.js, Mem0, LlamaIndex, OpenHands, and awesome-llm-apps.
- Initial threat model and capability permission matrix.

### Changed
- Memory search now weights rare terms and tag matches more strongly than common terms.
- Agent progress events and explicit checkpoints count one logical step when they share the same label.

### Security
- Checkpoint state is restricted to bounded, safe JSON data.
- Invalid stored checkpoint records and stale writes are rejected.
- No provider credentials, shell access, or unrestricted host capabilities were added.

### Current limitations and release gates
- Browser preview remains a disconnected demonstration: it uses local sample data and cannot call the native provider, credential vault, or owner filesystem.
- The native desktop stores workspace records, agent checkpoints, audit events, and traces in SQLite. Provider secrets use platform credential-vault adapters; these still require manual lifecycle verification in real desktop sessions.
- One-time approval grants intentionally remain ephemeral and must be re-issued after restart. Automatic replay/reconciliation of uncertain external side effects is not implemented.
- Semantic vector embeddings remain in WebView IndexedDB; SQLite is authoritative for knowledge text and metadata. Lexical retrieval remains the fallback.
- The MCP transport supports configured HTTP(S) servers without OAuth/bearer-token authentication; native stdio transport is not implemented.
- Voice capture/output, unrestricted shell execution, arbitrary desktop automation, and hosted multi-user proxy are outside Release 1.0 scope.
- SQLite, browser stores, checkpoints, and exported backups are not application-level encrypted; rely on OS/device protection and treat backups as sensitive.
- The repository commits `src-tauri/Cargo.lock`. Rust dependency review still tracks two known advisories (`proc-macro-error` is unmaintained; `glib 0.18.5` has an unsound iterator implementation requiring a compatible GTK/WebKit stack upgrade); these remain release-hardening items.

- Phase II completed for browser-preview/runtime scope: added ToolRegistry, HTTP-capable MCP JSON-RPC client and schema adapter, ModelRouter-backed planning adapter with plan validation, resumable-agent coordinator with approval pause/resume, persistent local trace sink, Trace Inspector, and runtime factories. CI passed on 2026-11-08 with 22 test files and 81 tests. See IMPLEMENTATION_PLAN.md for explicit production boundaries.
