# NEXUS AU — Implementation Plan

> **Strategic direction update (2026-11-11):** NEXUS AU is a private, single-owner hybrid local-and-cloud AI ecosystem. Local inference remains available; OmniRoute is the selected gateway for cloud model routing. NEXUS Model adaptation is a later development goal, while from-scratch foundation-model research is deferred outside the active roadmap. A standalone mobile interface preview is being developed in parallel; it does not replace the desktop product or require a working AI backend.

## Parallel delivery — Mobile interface preview

The preview is isolated behind the `?demo=1` query parameter. The standard desktop entry point continues to render the existing Tauri-oriented application. The preview uses local in-memory sample content only; it does not invoke Tauri commands, call OmniRoute, read provider credentials, or persist personal workspace data. Chat input is intentionally demo-only and displays a notice instead of calling a model.

The first preview slice includes Chat, Projects, Memory, and Settings layouts with an iPhone-safe viewport, bottom navigation, and demo-only interactions. Next steps are production-build verification, publishing a static preview URL, and checking the layout in Safari on a real iPhone.

## Current verified baseline

The active branch is `feat/nexus-core-architecture`. It contains the React + TypeScript + Vite workspace, Tauri 2/Rust host, SQLite persistence, memory and knowledge retrieval, agent runtime, MCP HTTP transport, Tool Gateway, OS credential-vault support, backup/restore, and cross-platform CI workflows. The native provider command supports one-shot and bounded SSE OpenAI-compatible chat requests through OmniRoute, bounded `/v1/models` discovery, incremental chat rendering, local/remote route disclosure, and native stream cancellation with early-consumer cleanup. The selected inference location is now an explicit owner-declared setting rather than being inferred from a localhost gateway URL; it is persisted with provider settings but is not independently verified by the gateway. Model capability metadata and unified runtime lifecycle remain open. Training Lab now includes dataset-governance validation, deterministic phrase-based evaluation, SQLite persistence for versioned dataset manifests and immutable experiment metadata, and a workspace UI. Artifact tracking, real model evaluation, and model training are not claimed.

The last baseline with recorded cross-platform CI evidence is older than the current documentation/UI changes. The latest branch head must pass fresh CI before those changes are treated as verified. Real interactive desktop and credential-vault smoke tests remain separate manual acceptance items.

> **Historical implementation record:** The milestone and phase notes below preserve the repository's earlier implementation sequence. For the current seven-phase delivery plan, use the authoritative phase map in `docs/ROADMAP.md`.

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

Exit criteria: no tool can execute outside the gateway; high-risk actions require explicit approval.

## Milestone 6 — Bounded agent runtime
- [x] Implement bounded single-agent runtime primitive
- [x] Add agent registration and metadata registry
- [x] Enforce step and time budgets (token budget pending)
- [x] Add cancellation, stop conditions, approval handoff, and checkpoint resume
- [x] Add deterministic runtime tests and a mock Tool Gateway integration test

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

