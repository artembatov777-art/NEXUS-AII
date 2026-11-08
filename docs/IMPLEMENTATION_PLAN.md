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


## Phase II — Tools and Intelligence (in progress)

Implemented on `feat/nexus-core-architecture`:
- [x] Metadata-only Tool Registry with registration, removal, tag search, and gateway-backed execution.
- [x] MCP JSON-RPC client core with initialization, tool discovery, response correlation, disconnect, and import through Tool Gateway.
- [x] Reuse the existing Tool Gateway for permission checks, audit, cancellation, timeouts, and bounded JSON inputs/outputs.
- [x] Agent Planner contract and plan validator for tool allowlists, bounded steps, JSON input size, and dependency ordering.
- [x] Multi-agent coordination primitive with sequential delegation, explicit per-agent authorization, dependency result passing, and cancellation.
- [x] In-memory trace sink and operation lifecycle helper with bounded retention and sensitive-attribute filtering.
- [x] Compose Tool Registry and MCP client into the browser-preview runtime.
- [x] Add unit tests for registry, MCP protocol flow, plan validation, coordination, tracing, and runtime composition.

Still required before Phase II acceptance:
- [ ] Add a real MCP transport adapter (stdio/native desktop and/or explicitly configured HTTP transport); current MCP client accepts an injected transport only.
- [ ] Bind planner to the model router/provider and add model-backed planning tests; current planner consumes a provider-neutral planner port.
- [ ] Connect multi-agent coordination to registered resumable agent definitions and define approval/resume semantics for delegated tasks.
- [ ] Add persistent trace storage and a trace inspection UI; current trace sink is in-memory.
- [ ] Add adversarial tests for malicious MCP metadata/results, transport disconnects, cancellation races, and planner output fuzzing.
- [ ] Run and pass GitHub Actions for the latest phase commit.

Phase II is **not complete** until these acceptance items are implemented and CI is green. No external MCP server or autonomous model planning is claimed as operational.
