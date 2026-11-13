# NEXUS AU — Implementation Plan

> **Strategic direction update (2026-11-14):** NEXUS AU is a private, single-owner hybrid local-and-cloud AI ecosystem. Core development uses a provider-neutral router and direct compatible local/cloud endpoints. The non-connecting OmniRoute profile builder and adapter path are prepared; live gateway connection remains deferred until final integration, and no core module may depend on it. NEXUS Model adaptation is a later development goal, while from-scratch foundation-model research is deferred outside the active roadmap. The phase history below records implementation work and must be read together with VISION.md, ARCHITECTURE.md, SYSTEM_DESIGN.md, and ROADMAP.md. This update does not mark planned model work as implemented.

## Current verified baseline

The active branch is `feat/nexus-core-architecture`. It contains the React + TypeScript + Vite workspace, Tauri 2/Rust host, SQLite persistence, memory and knowledge retrieval, agent runtime, MCP HTTP transport, Tool Gateway, OS credential-vault support, backup/restore, and cross-platform CI workflows. The native provider command supports bounded SSE OpenAI-compatible chat requests through a directly configured compatible endpoint, bounded `/v1/models` discovery, incremental chat rendering, local/remote route disclosure, and native stream cancellation with early-consumer cleanup. The selected inference location is now an explicit owner-declared setting rather than being inferred from a localhost provider URL; it is persisted with provider settings but is not independently verified by the provider endpoint. An in-memory provider-neutral Model Registry now tracks the discovered catalog, explicit active-model selection, and catalog discovery state; it does not claim verified inference health. Capability metadata and the actual runtime lifecycle remain open. Training Lab now includes dataset-governance validation, explicit JSON/JSONL sample import/export with split integrity checks in TypeScript and Rust, SQLite persistence for versioned dataset manifests and immutable experiment metadata, deterministic phrase-based evaluation, live model comparison with per-model failure isolation, and a workspace UI. Artifact tracking, semantic evaluation, and model-weight training are not claimed.

Commit `ae4276e` passed frontend Quality (52 test files / 311 tests; npm audit reported 0 vulnerabilities) and the Mobile Interface Preview workflow. The Windows/macOS/Linux native matrix is still running. Real interactive desktop and credential-vault smoke tests remain separate manual acceptance items.

## Parallel delivery — Mobile interface preview

The preview is isolated behind the `?demo=1` query parameter. The standard desktop entry point continues to render the existing Tauri-oriented application. The preview uses local in-memory sample content only; it does not invoke Tauri commands, call AI providers, read provider credentials, or persist personal workspace data. Chat input is intentionally demo-only and displays a notice instead of calling a model.

The first preview slice includes Chat, Projects, Memory, and Settings layouts with an iPhone-safe viewport, bottom navigation, and demo-only interactions. The production build and Quality workflow passed on the active branch. The first GitHub Pages deployment is now successful. The initial `github-pages` deployment environment caused the deploy job to fail before a runner was assigned; switching the preview workflow to a dedicated `nexus-mobile-preview` environment allowed the deployment action to run and report success. Hosted preview URL: `https://artembatov777-art.github.io/NEXUS-AII/`; open it with `?demo=1` to enter the isolated mobile demo. The remaining acceptance work is to verify the hosted page in iPhone Safari and refine the layout from real-device feedback. The demo remains disconnected from AI providers and credentials.

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
- [x] Add transactional SQLite-backed native audit persistence, duplicate-claim guards, and owner-confirmed reconciliation for ambiguous tool outcomes; browser preview audit remains localStorage-only.
- [x] Add core one-time, run/agent/permission-bound approval grants and resume validation
- [x] Add user-facing approval queue with explicit one-time approve/reject actions backed by versioned checkpoints (localStorage in browser preview, SQLite in desktop).
- [x] Add serializable step-based runtime with checkpointed state transitions and resume/approval entry points
- [x] Add a host-identity-bound adapter from resumable agent steps to the permission-enforcing Tool Gateway
- [x] Compose checkpoint, audit, gateway, bridge, approval authority, and resumable runtime in fail-closed browser and native composition roots.
- [x] Wire resumable runtime into the Agent Control Center with start, cancel, resume, checkpoint history, and approval handoff
- [ ] Add operation-level idempotency with persisted, input-bound results; automatic result replay remains deferred, and ambiguous external side effects are manually reconciled without rerunning tools.

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

**Release risk carried forward:** earlier CI reported 11 npm dependency advisories. On commit `ae4276e`, `npm audit --audit-level=high` reported 0 vulnerabilities; this must remain green. A committed Rust `Cargo.lock` and Rust dependency advisory audit are still outstanding release-hardening items.

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

**Current boundary:** native desktop records for chats, projects, memories, and knowledge chunks are stored in SQLite. Project ownership is checked in SQLite and project deletion cleans associated records. Vector embeddings still use IndexedDB in the WebView; lexical retrieval remains available if semantic indexing is unavailable. API keys are stored in the platform credential vault and provider requests pass only a fixed scoped handle. Backups cover structured workspace data but intentionally exclude provider credentials and cached vector embeddings. Clipboard actions require an explicit user click. Voice remains browser/WebView-based, not a native offline engine. Commit `ae4276e` passed frontend Quality (52 test files / 311 tests; npm audit reported 0 vulnerabilities) and the Mobile Interface Preview deployment. The Windows/macOS/Linux native matrix passed on `ae4276e`. CI compile/test coverage is not an interactive GUI launch; manual desktop and credential-vault smoke tests remain open. Phase IV is not complete.


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

**Phase VI status:** active. The checklist is not complete until every remaining acceptance item is implemented, tested, and verified in CI. The OmniRoute profile builder and multi-profile adapter path are prepared without a live connection. Verify the real gateway only during final integration after the provider-neutral AI Core and all core modules are complete.


## Active phase map — authoritative (2026-11-12)

The owner-approved seven-phase sequence is interface-first. Historical milestones above document implementation history only; they do not override this sequence.

1. **Phase I — Complete interface:** full desktop and mobile workspace, all module surfaces, design system, responsive behavior, accessibility, UI contracts, and honest mock/empty/error states.
2. **Phase II — AI Core:** provider-neutral router, direct cloud adapters, local Ollama adapter, model registry/runtime, model discovery, health, streaming, cancellation, usage, and route disclosure.
3. **Phase III — Memory & Knowledge:** durable inspectable memory, document ingestion, project knowledge, semantic retrieval, citations, and AI Core context integration.
4. **Phase IV — Agents & Tools:** model-driven planning, bounded agent runtime, approvals, checkpoints, MCP, Tool Gateway, and auditable execution.
5. **Phase V — NEXUS File System:** native Windows folder permissions, browsing/search, file reading and analysis, controlled writes, previews, and recovery.
6. **Phase VI — Security & Integration:** cross-module integration, permission enforcement, OS credential vault, backup/restore, audit, error handling, and threat-model review.
7. **Phase VII — Testing & Release 1.0:** full automated test matrix, native platform builds, real desktop smoke tests, packaging, installation, and release evidence.

## Phase I — Complete interface: exit checklist

- [x] Establish the restrained JARVIS visual language and shared responsive styling.
- [x] Build the desktop workspace shell, navigation, chat, history, and system overview.
- [x] Add workspace panels for Projects, Memory, Knowledge, Agents, Tools & MCP, File System, Training Lab, global search, and provider settings.
- [x] Add backup/restore controls to provider settings.
- [x] Add the isolated iPhone-oriented `?demo=1` preview without provider or credential access.
- [x] Add responsive layouts to the main application and mobile preview.
- [x] Add visible keyboard focus and reduced-motion behavior.
- [x] Add responsive mobile navigation and consistent dialog Escape/focus/scroll handling.
- [x] Audit every visible control, loading/empty/error state, and module transition; native-only and preview-only actions are explicitly disabled or disclosed.
- [x] Add automated UI interaction coverage for mobile navigation, preview-only chat/agent actions, empty input handling, keyboard shortcuts, and dialog keyboard contracts.
- [ ] Verify both the hosted preview and main responsive application on a real iPhone.
- [ ] Pass frontend Quality, mobile-preview deployment, and native build/test workflows on the final Phase I head; current commit `ae4276e` passed frontend Quality and mobile preview, while the native matrix is still running.

**Phase I status: in progress.** Do not mark complete until every exit item is satisfied. The current interface contains deliberately disconnected/mock surfaces for integrations implemented in later phases; those surfaces must disclose that they are not live.

## Model strategy

- Local inference remains supported when a suitable local runtime is available.
- Compatible local and cloud endpoints connect directly through the provider-neutral router; OmniRoute profile preparation is implemented; live gateway connection is deferred until final integration.
- An endpoint address does not prove that inference is local; route disclosure must use an explicit configured setting and remain honest about its verification limits.
- Ollama runs on a computer or server with suitable resources. It cannot run locally on the owner's iPhone.
- Provider credentials stay in the OS credential vault. Browser preview must never store or transmit provider secrets.
- Training a foundation model from scratch is deferred to future research and is not a Release 1.0 requirement.

**Status rule:** code written, automated tests passed, CI passed, and behavior verified on a real device/runtime are separate evidence levels. Documentation, UI presets, and mock providers are not proof of working integration.
