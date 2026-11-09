# NEXUS AU — Implementation Plan

## Current verified baseline

The `feat/foundation-0.1` branch contains a React + TypeScript + Vite UI, Tauri 2/Rust host, a basic chat flow, local browser persistence, provider settings, and an initial CI workflow. The frontend production build passed in GitHub Actions. Native Tauri compilation has not yet been verified.

The current draft PR #1 remains separate from this architecture work. Do not merge it automatically as part of this plan.

## Milestone 0 — Architecture baseline
- [x] Create modular system design
- [x] Define module contracts
- [x] Add initial threat model and permission matrix (security implementation remains incomplete)
- [x] Establish ADR records and changelog
- [ ] Review contracts with maintainers

Exit criteria: module boundaries, dependency direction, and security defaults are documented.

## Milestone 1 — Core domain and application facade
- [x] Create initial domain types for IDs, messages, conversations, models, errors, and operation events
- [x] Create initial conversation service and repository port
- [ ] Move UI away from direct infrastructure calls
- [x] Add Vitest and baseline conversation service tests
- [ ] Add lint/typecheck/test/build CI stages

Exit criteria: application use cases can be tested without React, Tauri, network, or a real model.

## Milestone 2 — Provider router and streaming
- [x] Define provider port
- [ ] Implement OpenAI-compatible adapter
- [x] Add streaming events and cancellation contract
- [ ] Normalize errors and usage
- [x] Add mock provider contract tests (real adapter tests remain pending)

Exit criteria: streamed responses work through the same application interface with a mock and a real compatible provider.

## Milestone 3 — Durable local data
- [ ] Define SQLite schema and migrations
- [x] Define versioned agent checkpoint contract and local preview repository
- [ ] Implement conversation and message repositories
- [ ] Add export/import format
- [ ] Add backup and recovery tests
- [x] Add checkpoint sequence, validation, and stale-write tests

Exit criteria: data survives restarts and can be exported without provider credentials.

## Milestone 4 — Context and memory
- [x] Define memory record schema and provenance
- [x] Add user-approved memory write path
- [x] Add repository-backed retrieval contract and validation
- [x] Add relevance scoring in browser storage adapter
- [ ] Add source attribution in UI
- [ ] Add inspect/edit/delete controls

Exit criteria: the system can explain which memory records influenced a response and users can correct or delete them.

## Milestone 5 — Permissions and tool gateway
- [x] Define permission service port and default-deny gateway behavior
- [x] Add tool registry and input validation port
- [x] Add audit events, timeout, cancellation, and input/output limits
- [x] Add LocalStorage preview audit adapter and explicit non-retryable outcome when completion audit fails
- [ ] Replace preview audit storage with transactional native persistence and reconciliation
- [x] Add core one-time, run/agent/permission-bound approval grants and resume validation
- [x] Add user-facing approval queue with explicit one-time approve/reject actions (browser preview; native durable state remains pending)
- [x] Add serializable step-based runtime with checkpointed state transitions and resume/approval entry points
- [x] Add a host-identity-bound adapter from resumable agent steps to the permission-enforcing Tool Gateway
- [x] Compose checkpoint, audit, gateway, bridge, approval authority, and resumable runtime in a fail-closed browser-preview composition root
- [x] Wire resumable runtime into the Agent Control Center with start, cancel, resume, checkpoint history, and approval handoff
- [ ] Add operation-level idempotency for side effects and replace browser preview persistence with transactional native storage

Exit criteria: no tool can execute outside the gateway; high-risk actions require explicit approval.

## Milestone 6 — Bounded agent runtime
- [x] Implement bounded single-agent runtime primitive
- [x] Add agent registration and metadata registry
- [x] Enforce step and time budgets (token budget pending)
- [x] Add cancellation, stop conditions, approval handoff, and checkpoint resume
- [x] Add deterministic runtime tests and a mock Tool Gateway integration test
- [x] Add composition-root integration coverage for approval, tool execution, checkpoint completion, audit events, and default-deny behavior

Exit criteria: agents can complete bounded tasks, explain actions, and stop safely.

## Milestone 7 — MCP and integrations
- [ ] Add MCP client adapter
- [ ] Require per-server and per-tool approvals
- [ ] Isolate untrusted tool metadata and outputs
- [ ] Add integration health and audit UI

Exit criteria: MCP tools can be enabled/disabled individually and cannot bypass permissions.

## Milestone 8 — Voice and desktop
- [ ] Add speech-to-text adapter
- [ ] Add text-to-speech adapter
- [ ] Add push-to-talk and interrupt
- [ ] Add secure OS credential storage
- [ ] Verify Tauri builds on supported desktop platforms

Exit criteria: voice and native integration are reliable, optional, and permission-scoped.

## Milestone 9 — Hosted web client
- [ ] Add server-side model proxy
- [ ] Add user authentication and per-user quotas
- [ ] Keep provider keys server-side
- [ ] Add abuse protection and request limits
- [ ] Deploy only after security review

Exit criteria: public browser clients cannot use a shared secret anonymously or without quotas.

## Phase I — Agent Control Center (completed: browser-preview scope, 2026-11-08)

- [x] Integrate the resumable runtime, checkpoints, approval authority, Tool Gateway, and audit sink through the composition root.
- [x] Add a built-in local workflow agent and a harmless preview tool routed through the Tool Gateway.
- [x] Add a metadata-only runtime registry and a Control Center entry in the workspace navigation.
- [x] Add task submission, live progress/output, cancellation, checkpoint continuation, run history, and saved result inspection.
- [x] Add explicit one-time approval and rejection actions.
- [x] Add editable profile name, step/time budgets, local persistence, validation, and versioned runtime replacement.
- [x] Prevent profile changes while this workspace has running or approval-waiting checkpoints.
- [x] Add integration tests for approval, gateway routing, audit lifecycle, checkpoint completion, profile persistence, profile replacement, and invalid inputs.
- [x] Verify GitHub Actions: run 42518677919 completed successfully; 13 test files, 61 tests, and production build passed.

**Phase I acceptance:** the browser-preview agent control plane is integrated and usable. This is a bounded local demonstration, not a model-powered autonomous agent. It makes no external calls and cannot access shell/filesystem capabilities.

## Deferred production hardening (not counted as Phase I preview blockers)

- [ ] Replace localStorage checkpoint/audit/profile persistence with transactional native storage.
- [ ] Persist approval grants and the full event log across restarts.
- [ ] Add safe checkpoint migration or explicit recovery for old agent versions.
- [ ] Add token budgets and operation-level idempotency for side effects.
- [ ] Implement real model-backed planning only after the separately scheduled provider integration phase.

## Engineering rules

- Every milestone is a pull request.
- Every PR must include tests and update docs when contracts change.
- Never claim a feature is complete because a placeholder UI exists.
- Never commit API keys, cookies, private tokens, or personal data.
- Keep the desktop and web clients on shared application contracts.
- Prefer a small working vertical slice over a broad set of fake features.


## Phase II — Tools and Intelligence (completed: browser-preview/runtime scope, 2026-11-09)

- [x] Tool Registry: validated registration, metadata-only discovery, tag search, unregister, and execution routed through Tool Gateway.
- [x] MCP JSON-RPC client: initialize, tool discovery, response correlation, bounded metadata, import and disconnect.
- [x] Browser HTTP MCP transport: explicit HTTP(S) endpoint, credentials omitted by default, redirects rejected, JSON and finite SSE responses supported.
- [x] MCP input validation: bounded JSON-Schema subset; unsupported root keywords, unknown properties, missing required fields, and type mismatches fail closed.
- [x] Safe tool execution: host actor validation, known permission scopes, input/output size limits, timeouts, cancellation, and audit lifecycle.
- [x] Model-backed planning adapter: `ModelRouterPlanner` uses the provider-neutral `ModelRouter`; generated JSON is then checked by `AgentPlanner` against tool allowlists, budgets, dependencies, and serialized input limits.
- [x] Multi-agent coordination: sequential delegated execution through registered resumable agents, dependency-result passing, explicit authorization, pause-on-approval and host-triggered resume.
- [x] Persistent trace sink: bounded localStorage retention, validation and sensitive-attribute filtering.
- [x] Trace Inspector added to Agent Control Center.
- [x] Runtime composition exposes MCP HTTP connection/import helpers, optional model-backed planner creation, and coordinator creation.
- [x] Security and integration tests added for tool registration/identity, MCP transport/schema, model planning, coordination resume, trace persistence, and runtime composition.
- [x] GitHub Actions run 42525214016 passed: 22 test files, 81 tests, and production TypeScript/Vite build.

**Phase II acceptance:** all six roadmap modules are implemented and connected through the runtime composition for the browser-preview scope. CI is green on code commit `9859f133a31b1ed61684faf55e9f18374e0aad1f`.

### Phase II boundaries and production follow-up

- MCP currently supports explicit HTTP(S) request/response transport. Native stdio transport, OAuth negotiation, server-initiated notifications, and long-lived streaming sessions are not implemented.
- Browser MCP servers must permit the app origin through CORS. The HTTP adapter omits browser credentials and rejects redirects; endpoint access is user-configured.
- The MCP schema adapter intentionally supports a bounded JSON-Schema subset and rejects unsupported root-level keywords. Server-side validation remains authoritative.
- Model-backed planning is available when the host injects a configured `ModelRouter`. The existing local demo agent remains deterministic; the current preview does not silently convert it into an autonomous LLM agent.
- Multi-agent pending approval state is in memory. A host must record the user's decision in its permission policy before calling coordinator resume. Durable coordination checkpoints are future hardening.
- Browser trace/checkpoint/audit storage is localStorage, not encrypted, tamper-proof, or transactional. Native secure storage remains a later phase.
- The Agent Control Center displays trace events, but a complete visual MCP server manager and plan-review/execution workflow are not part of this phase.


## Phase III — Memory and Knowledge (complete)

- [x] Hybrid lexical/semantic retrieval with lexical fallback.
- [x] Local sentence-transformer embedding provider (Xenova/all-MiniLM-L6-v2), lazy model loading, and bounded input validation.
- [x] Durable IndexedDB vector storage with cosine ranking and project-filtered search.
- [x] Local project-scoped knowledge storage, document listing, atomic replacement, and deletion.
- [x] TXT, Markdown, PDF, and DOCX extraction with size limits; PDF page provenance is preserved.
- [x] Bounded paragraph-aware chunking, overlap, provenance, and deterministic project/file identity for re-indexing.
- [x] Knowledge UI for import, search, source inspection, document listing, and deletion.
- [x] Project-scoped memories with required project IDs and repository-level filtering.
- [x] Memory editing for content, category, scope, project assignment, tags, and source provenance; deletion controls.
- [x] Automatic retrieval of approved profile memories and selected-project memories/documents in the chat request pipeline.
- [x] Structured source references displayed with assistant responses.
- [x] Explicit project selection in chat and project knowledge panel.
- [x] CI acceptance: 29 test files / 102 tests passed; TypeScript production build and Vite build passed (GitHub Actions run 42545054890).

**Defined limitations:** the first semantic operation downloads the sentence-transformer model from Hugging Face; embeddings run locally after download. Lexical retrieval remains available if model loading or IndexedDB is unavailable. PDF extraction supports selectable text only; scanned-image OCR is not included. Project filtering is enforced by application repositories and retrieval paths, but browser localStorage/IndexedDB are not security boundaries against same-origin code or a compromised device. Native desktop memory and document records now use SQLite with project ownership checks and project-delete cleanup. Browser localStorage/IndexedDB remain preview stores and are not security boundaries against same-origin code or a compromised device; native vector embeddings still use the WebView IndexedDB store.

**Release risk carried forward:** npm install reported 11 dependency vulnerabilities (3 moderate, 6 high, 2 critical) during CI. The dependency tree must be audited and remediated as part of Phase V security/stabilization before a production release.

## Phase IV — Full application (in progress)

- [x] Add local project creation/listing/archiving UI and project metadata service.
- [x] Add conversation-history search across titles and message content.
- [x] Add optional push-to-talk-style speech recognition control and text-to-speech playback using browser/WebView speech APIs.
- [x] Add project-aware conversation ownership, workspace-scoped history filtering, conversation reassignment, and legacy conversation storage migration.
- [x] Add project-specific ownership for conversations, memories, and knowledge chunks; enforce project references in SQLite and delete project-owned records when a project is deleted.
- [x] Add native SQLite persistence for conversations, messages, projects, memories, and knowledge chunks, with first-launch migration from browser storage.
- [x] Add versioned SQLite migrations through schema v4; add project-reference validation and cascade-cleanup tests.
- [x] Add versioned workspace JSON backup export/import with bounded validation and transactional restore; expose backup controls in desktop settings.
- [ ] Add automated backup/restore round-trip and corruption-recovery integration tests.
- [x] Add native OS credential vault adapters for Windows Credential Manager, macOS Keychain, and Linux Secret Service; provider requests use a scoped credential handle rather than an API-key command argument.
- [x] Add explicit user-triggered system clipboard read/write commands with 1 MB bounds and copy/paste controls.
- [ ] Add native file-picker workflows, notifications, and deep-link integrations with explicit permissions.
- [ ] Verify full Tauri application builds and runtime behavior on Windows, macOS, and Linux; run native SQLite backup/restore integration tests.
- [ ] Add streaming voice, device selection, and native speech adapters where supported; current browser/WebView speech controls remain optional and host-dependent.
- [x] Add desktop workspace data export/import UI and app-wide lexical search across conversations, memories, and project knowledge (bounded to the first 50 projects); [ ] complete accessibility and keyboard-navigation audit.
- [ ] Complete security review, dependency audit, CSP/capability review, and release packaging.

**Current boundary:** native desktop records for chats, projects, memories, and knowledge chunks are stored in SQLite. Project ownership is checked in SQLite and project deletion cleans associated records. Vector embeddings still use IndexedDB in the WebView; lexical retrieval remains available if semantic indexing is unavailable. API keys are stored in the platform credential vault and provider requests pass only a fixed scoped handle. Backups cover structured workspace data but intentionally exclude provider credentials and cached vector embeddings. Clipboard actions require an explicit user click. Voice remains browser/WebView-based, not a native offline engine. Windows, macOS, and Linux CI matrix has been added and is running; platform build/runtime verification is not considered complete until all matrix jobs pass. The remaining native integrations and audits are still open. Phase IV is not complete.


## Phase VI — Completion and hardening of Phases II–IV (active)

### Verified baseline and completed work
- [x] Repaired duplicate Tauri command registration and credential-vault command exposure.
- [x] Added project/document-scoped transactional Knowledge replacement and deletion; no global document wipe on a single-document update.
- [x] Hardened native provider requests: HTTPS required except loopback HTTP, embedded URL credentials/query/fragment rejected, redirects disabled, request/response bounds enforced, supported message roles validated, and provider keys redacted from error excerpts.
- [x] GitHub Actions passed for commit `03a99e74c88fa73251dd5cafc9c5eafcf2f6243a`: frontend Quality and Native desktop quality matrix (Windows, macOS, Linux).
- [x] Fixed all-scope Memory listing so project memories are not silently hidden when the caller requests all scopes.
- [x] Added a 2 MB streaming response cap to the MCP HTTP transport and tests for declared and undeclared oversized responses.

### Remaining acceptance work
- [ ] Add persistent native integration tests for SQLite CRUD, project cleanup, document replacement, backup import/export, and schema upgrades.
- [ ] Make Memory and Knowledge migration idempotent under partial failure and concurrent startup.
- [ ] Verify IndexedDB vector-index lifecycle on document replacement/deletion and project deletion; add rebuild/reconciliation.
- [ ] Validate multi-agent plans at coordinator boundary (unique step IDs, dependency graph, assignment coverage, output bounds, and cancellation).
- [ ] Complete MCP protocol lifecycle, server capability negotiation, bounded SSE framing, reconnect/health state, and adversarial schema tests.
- [ ] Connect model-backed planning to the resumable permission-gated runtime, not just standalone planner primitives.
- [ ] Persist agent checkpoints, approvals, audit events, and traces transactionally in native SQLite.
- [ ] Finish workspace-wide search across conversations, memories, and project knowledge with explicit scope.
- [ ] Finish voice state/error handling and document WebView/browser host limitations; native speech adapters remain a separate integration.
- [ ] Add verified backup/restore UI with schema validation, confirmation, and rollback on import failure.
- [ ] Complete cross-platform credential vault UX and security review.
- [ ] Run end-to-end tests across real Tauri desktop builds and document platform-specific limitations.

**Phase VI status:** active. The checklist is not complete until every remaining acceptance item is implemented, tested, and verified in CI. No OmniRoute work is included here.
