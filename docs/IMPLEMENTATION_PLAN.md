# NEXUS AU — Implementation Plan

## Current verified baseline

The `feat/foundation-0.1` branch contains a React + TypeScript + Vite UI, Tauri 2/Rust host, a basic chat flow, local browser persistence, provider settings, and an initial CI workflow. The frontend production build passed in GitHub Actions. Native Tauri compilation has not yet been verified.

The current draft PR #1 remains separate from this architecture work. Do not merge it automatically as part of this plan.

## Milestone 0 — Architecture baseline
- [x] Create modular system design
- [x] Define module contracts
- [ ] Add threat model and permission matrix
- [ ] Add ADR process and changelog
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
- [ ] Implement default-deny permission service
- [ ] Add tool registry and schema validation
- [ ] Add audit events, timeout, cancellation, and output limits
- [ ] Add approval UI

Exit criteria: no tool can execute outside the gateway; high-risk actions require explicit approval.

## Milestone 6 — Bounded agent runtime
- [x] Implement bounded single-agent runtime primitive
- [x] Add agent registration and metadata registry
- [x] Enforce step and time budgets (token budget pending)
- [x] Add cancellation, stop conditions, and approval handoff (resume pending)
- [x] Add deterministic runtime tests (mock tool gateway pending)

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

## Engineering rules

- Every milestone is a pull request.
- Every PR must include tests and update docs when contracts change.
- Never claim a feature is complete because a placeholder UI exists.
- Never commit API keys, cookies, private tokens, or personal data.
- Keep the desktop and web clients on shared application contracts.
- Prefer a small working vertical slice over a broad set of fake features.
