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

**Defined limitations:** the first semantic operation downloads the sentence-transformer model from Hugging Face; embeddings run locally after download. Lexical retrieval remains available if model loading or IndexedDB is unavailable. PDF extraction supports selectable text only; scanned-image OCR is not included. Project filtering is enforced by application repositories and retrieval paths, but browser localStorage/IndexedDB are not security boundaries against same-origin code or a compromised device. Native encrypted storage and OS-level project ACLs belong to Phase IV/V hardening.

**Release risk carried forward:** npm install reported 11 dependency vulnerabilities (3 moderate, 6 high, 2 critical) during CI. The dependency tree must be audited and remediated as part of Phase V security/stabilization before a production release.

## Phase IV — Full application (in progress)

- [x] Add local project creation/listing/archiving UI and project metadata service.
- [x] Add conversation-history search across titles and message content.
- [x] Add optional push-to-talk-style speech recognition control and text-to-speech playback using browser/WebView speech APIs.
- [x] Add project-aware conversation ownership, workspace-scoped history filtering, conversation reassignment, and legacy conversation storage migration.
- [ ] Add project-specific file ownership and enforce context isolation across all retrieval paths.
- [ ] Add conversation/message repository migration from localStorage to SQLite.
- [ ] Add versioned SQLite schema, transactional migrations, backup/export/import, and recovery tests.
- [ ] Add native OS credential vault; remove API keys from ad-hoc command payloads and use scoped credential handles.
- [ ] Add native desktop file, notification, clipboard, and deep-link integrations behind explicit permission gates.
- [ ] Verify Tauri builds and runtime tests on supported desktop platforms.
- [ ] Add voice streaming, interruption, device selection, and native speech adapters where supported.
- [ ] Add app-wide search, data export/import UI, accessibility and keyboard navigation audit.
- [ ] Complete security review, dependency audit, CSP/capability review, and release packaging.

**Current boundary:** voice is optional browser/WebView speech API support; availability and recognition privacy depend on the host OS/browser. It is not a native offline speech engine. Project UI currently manages project metadata but does not yet bind chats/documents into isolated project workspaces. Browser localStorage remains the persistence adapter; native SQLite and credential vault are not implemented. Phase IV is not complete.
