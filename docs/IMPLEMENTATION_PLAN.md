# NEXUS AU — Implementation Plan

> **Strategic direction update (2026-11-11):** NEXUS AU is a private, single-owner hybrid local-and-cloud AI ecosystem. Local inference remains available; OmniRoute is the selected gateway for cloud model routing. NEXUS Model adaptation is a later development goal, while from-scratch foundation-model research is deferred outside the active roadmap. The phase history below records implementation work and must be read together with VISION.md, ARCHITECTURE.md, SYSTEM_DESIGN.md, and ROADMAP.md. This update does not mark planned model work as implemented.

## Current verified baseline

The active branch is `feat/nexus-core-architecture`. It contains the React + TypeScript + Vite workspace, Tauri 2/Rust host, SQLite persistence, memory and knowledge retrieval, agent runtime, MCP HTTP transport, Tool Gateway, OS credential-vault support, backup/restore, and cross-platform CI workflows. The existing native provider command supports one-shot OpenAI-compatible chat requests and can target a local OmniRoute `/v1` endpoint; bounded `/v1/models` discovery, SSE token streaming, incremental chat rendering, and local/remote route disclosure are implemented in the current branch. Native mid-stream cancellation, model capability metadata, and unified runtime lifecycle remain open. Training Lab dataset/evaluation contracts and multimodal processing policy contracts have also been added; no model training or image/audio inference is claimed.

The last baseline with recorded cross-platform CI evidence is older than the current documentation/UI changes. The latest branch head must pass fresh CI before those changes are treated as verified. Real interactive desktop and credential-vault smoke tests remain separate manual acceptance items.

> **Historical implementation record:** The milestone and phase notes below preserve the repository's earlier implementation sequence. For the current seven-phase delivery plan, use the authoritative phase map at the end of this document.

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

## Milestone 9 — Hosted web client (deferred; not current product scope)
- [ ] Revisit only if the owner later wants a remote/web companion client.
- [ ] If introduced, use a server-side model proxy, authentication, scoped secrets, request limits, and a security review.

**Current decision:** a hosted public client, multi-user accounts, and per-user quotas are outside the personal NEXUS AU product scope.

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


### Native agent checkpoint persistence (implemented: 2026-11-09)

- [x] Add SQLite schema v5 for agent checkpoints and a thread/update index.
- [x] Add native load, list, save, and delete commands.
- [x] Enforce bounded JSON payloads, valid statuses, immutable run identity/creation time, terminal-state immutability, and transactional compare-and-swap sequence checks in the Rust host.
- [x] Route the desktop Agent Control Center through the native repository; browser preview continues to use localStorage.
- [x] Add Rust persistence/CAS/validation tests and TypeScript command-adapter tests.

**Boundary:** checkpoint state now survives desktop restarts. Tool audit and trace history still use localStorage. Approval grants are deliberately not persisted: a pending checkpoint can be loaded after restart, but the user must explicitly approve again to obtain a fresh one-time grant.

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

**Current boundary:** native desktop records for chats, projects, memories, and knowledge chunks are stored in SQLite. Project ownership is checked in SQLite and project deletion cleans associated records. Vector embeddings still use IndexedDB in the WebView; lexical retrieval remains available if semantic indexing is unavailable. API keys are stored in the platform credential vault and provider requests pass only a fixed scoped handle. Backups cover structured workspace data but intentionally exclude provider credentials and cached vector embeddings. Clipboard actions require an explicit user click. Voice remains browser/WebView-based, not a native offline engine. Windows, macOS, and Linux CI matrix has been added and is running; platform build/runtime verification is not considered complete until all matrix jobs pass. The remaining native integrations and audits are still open. The current baseline `a9016a8c05bd5fe91104eda8da2f872767c38677` passes frontend Quality and native build/Rust tests on Windows, macOS, and Linux, but this is compile/test coverage rather than an interactive GUI launch. Phase IV is not complete.


## Historical work log — Completion and hardening of earlier Phases II–IV

### Verified baseline and completed work
- [x] Repaired duplicate Tauri command registration and credential-vault command exposure.
- [x] Added project/document-scoped transactional Knowledge replacement and deletion; no global document wipe on a single-document update.
- [x] Hardened native provider requests: HTTPS required except loopback HTTP, embedded URL credentials/query/fragment rejected, redirects disabled, request/response bounds enforced, supported message roles validated, and provider keys redacted from error excerpts.
- [x] GitHub Actions passed for commit `03a99e74c88fa73251dd5cafc9c5eafcf2f6243a`: frontend Quality and Native desktop quality matrix (Windows, macOS, Linux).
- [x] Fixed all-scope Memory listing so project memories are not silently hidden when the caller requests all scopes.
- [x] Added a 2 MB streaming response cap to the MCP HTTP transport and tests for declared and undeclared oversized responses.
- [x] Enforced the native provider response limit incrementally while streaming chunks, with a boundary unit test.
- [x] Added strict coordinator-boundary validation for unique step IDs, prior-step dependencies, exact assignment coverage, and bounded plan size, with negative tests.
- [x] Added workspace backup import/export controls in Settings; imports require confirmation and clear stale semantic vectors to prevent results from an older backup leaking into restored project searches.

### Remaining acceptance work
- [x] Added native SQLite integration tests for project/conversation/memory/knowledge cleanup, transactional document replacement and rollback, backup round-trip and failed-import recovery, checkpoint persistence, audit/trace persistence, and schema upgrades through v6.
- [x] Make Memory, Knowledge, and Project local-to-SQLite migrations retry-safe after partial failure; missing IDs are imported without overwriting existing native records. Schema migrations now run inside one SQLite `EXCLUSIVE` transaction to serialize concurrent startup upgrades.
- [x] Reconcile the IndexedDB vector index against authoritative knowledge chunks on startup and after backup restore; rebuild missing embeddings in bounded batches, remove stale/deleted-document vectors, use project-composite vector keys, and clear vectors when a native project is deleted.
- [x] Validate multi-agent plans at the coordinator boundary and enforce 64 KB delegated-output limits, JSON-only handoff, cancellation checks after awaited operations, and exception-to-failure conversion with negative tests.
- [x] Complete the supported MCP lifecycle: initialize/capability validation, initialized notification, bounded paginated tool discovery, reconnect and health state, correlated bounded SSE framing, disconnect cleanup, and nested schema/input adversarial tests.
- [x] Connect model-backed planning to a bounded tool-invocation agent, ResumableAgentRuntime, coordinator approval gate, and Tool Gateway permission/audit checks; an integration test exercises the full path with a fake model and tool.
- [x] Persist resumable agent checkpoints transactionally in native SQLite with a versioned migration, bounded payload validation, compare-and-swap sequence enforcement, and thread-scoped listing.
- [x] Move tool audit events and traces to bounded transactional native SQLite tables with filtering, retention caps, attribute redaction, and native adapters. One-time approval grants intentionally remain ephemeral and must be re-issued by the user after restart.
- [x] Finish workspace-wide search across all conversations, all memories, and project knowledge across every project, with explicit per-category scope toggles and bounded results.
- [x] Harden voice input/output lifecycle, permission and host error handling, cancellation/unmount cleanup, and document WebView/browser service limitations; native speech adapters remain a separate integration.
- [x] Add backup/restore UI with schema validation, confirmation, transactional native import, round-trip tests, and rollback/recovery tests for validation and mid-transaction failures.
- [x] Implement native credential-vault status states (available/missing/unavailable), browser-preview fail-closed messaging, platform backend selection, and provider-key input validation with unit tests.
- [x] Add a source-level security review covering trust boundaries, provider/MCP controls, storage, permissions, CSP, and residual risks.
- [x] Document platform-specific WebView, keyring, speech, build, and persistence limitations.
- [x] Add a repeatable Windows/macOS/Linux manual desktop smoke-test procedure in `docs/PLATFORM_SMOKE_TESTS.md`.
- [x] Verify the native build and Rust test matrix on Windows, macOS, and Linux for commit `9d2d4c2304789be1724a1b5a8809b2ab8e841b02`; all three jobs and frontend Quality passed.
- [x] Publish short-lived per-OS native executable artifacts from CI so manual GUI/keyring smoke tests can be run against the exact tested commit.
- [x] Re-verify frontend Quality and native build/Rust tests on Windows, macOS, and Linux for current baseline `a9016a8c05bd5fe91104eda8da2f872767c38677`; all four workflow jobs passed and all three native artifacts uploaded.
- [ ] Execute and record credential-vault smoke tests on real Windows, macOS, and Linux desktop sessions; CI cannot validate an unlocked interactive keyring.
- [ ] Execute and record full GUI end-to-end smoke tests on real Tauri desktop builds for all supported OS families; current CI compiles the app and runs native integration tests but does not launch an interactive GUI.

**Phase VI status:** active. The checklist is not complete until every remaining acceptance item is implemented, tested, and verified in CI. OmniRoute integration is tracked in active Phase V, after the remaining manual desktop acceptance checks.


## Active phase map — authoritative (2026-11-11)

The seven phases below are the only active project phases. The earlier numbered milestones and historical phase notes above record implementation history; they do not override this active map.

1. **Phase I — Architecture and infrastructure:** React/TypeScript/Vite, Tauri/Rust, SQLite, domain contracts, CI and build foundations.
2. **Phase II — Workspace and interface:** chat, history, projects, settings, search, backup/restore, accessibility and desktop UX.
3. **Phase III — Memory, agents and tools:** memory/knowledge, document ingestion, retrieval, agent runtime, coordinator, Tool Gateway, MCP and audited execution.
4. **Phase IV — Desktop, security and stability:** native persistence, OS credential vault, backup recovery, platform builds, dependency/security review, accessibility and real desktop smoke tests.
5. **Phase V — NEXUS AI Core and OmniRoute:** model registry/runtime, OmniRoute cloud adapter, model discovery, streaming/cancellation, explicit local/cloud routing, context integration and model-backed planning.
6. **Phase VI — Training Lab and model development:** evaluation, curated datasets, experiment tracking, fine-tuning/adapters, artifact versioning and rollback.
7. **Phase VII — Multimodal AI and voice:** image/audio/voice capabilities, explicit local/remote processing, interruption and modality-specific adapters.

### Current model strategy

- Local inference remains a supported path when a suitable local runtime is available.
- OmniRoute is the selected gateway for cloud model routing and is accessed through its OpenAI-compatible `/v1` API.
- NEXUS AI Core uses provider-neutral contracts; local inference and OmniRoute are separate adapters behind the same runtime.
- Cloud processing must be visible to the owner. The NEXUS-to-OmniRoute key stays in the OS credential vault.
- The current native provider command can send a non-streamed OpenAI-compatible chat request to an OmniRoute endpoint. A bounded native `/v1/models` catalog command and settings UI have now been added; they remain pending fresh CI verification. SSE streaming, cancellation and unified runtime lifecycle are not yet complete.
- NEXUS Model adaptation is a later active development goal, but training a foundation model from scratch is deferred to Future Research. It is not an active phase and does not count toward project completion.

### Immediate engineering sequence

1. Finish code-addressable Phase IV work and verify the latest CI baseline.
2. Record real Windows/macOS/Linux desktop and credential-vault smoke tests when those interactive environments are available.
3. Complete Phase V native stream cancellation, model capability metadata, error/usage normalization, and explicit local/cloud routing.
4. Connect approved memory and project knowledge to the selected model runtime.
5. Connect model-driven agents through the existing Tool Gateway and coordinator.
6. Continue Phase VI with evaluation suites, dataset governance, and experiment persistence; fine-tuning stays gated on evidence and hardware.
7. Continue Phase VII with attachment ingestion, model-backed image/audio understanding, and explicit local/remote processing disclosure.

**Status rule:** documentation, UI presets, and mock providers are not proof of a working model integration. Every acceptance item requires implementation and automated or manual evidence appropriate to the feature.
