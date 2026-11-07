# NEXUS AU — Development Roadmap

This roadmap describes intended work. A phase is complete only when its acceptance criteria are implemented and verified.

## Phase 0 — Repository and foundation

- [x] Add initial product vision and architecture documents.
- [ ] Audit the existing repository and preserve working code.
- [ ] Establish project conventions and branch/PR workflow.
- [ ] Confirm the actual provider API contract and configuration.
- [ ] Add formatting, linting, type-checking, and CI.

**Acceptance:** a clean checkout can install dependencies and pass the documented checks.

## Phase 1 — Desktop foundation

- [ ] React + TypeScript + Vite application shell.
- [ ] Tauri 2 desktop integration.
- [ ] Rust command boundary and typed shared contracts.
- [ ] Navigation and reusable design system.
- [ ] Settings and provider configuration UI.
- [ ] Error, loading, and empty states.

**Acceptance:** desktop application launches and core navigation/settings work without mock claims.

## Phase 2 — AI Core

- [ ] Configurable provider adapter.
- [ ] Model selection.
- [ ] Chat and conversation history.
- [ ] Streaming responses.
- [ ] Cancellation, timeout, and error handling.
- [ ] Local persistence.

**Acceptance:** a user can configure a verified provider, send a prompt, receive a response, and reopen the saved conversation.

## Phase 3 — Memory

- [ ] SQLite schema and migrations.
- [ ] User-controlled memory records.
- [ ] Project-scoped memory.
- [ ] Search and retrieval.
- [ ] Inspect, edit, and delete controls.

**Acceptance:** memory is inspectable and user-controlled, with tests for isolation and deletion.

## Phase 4 — Agents

- [ ] Agent definitions and model assignment.
- [ ] Task orchestration and status tracking.
- [ ] Step, time, and budget limits.
- [ ] Scoped tool permissions.
- [ ] Cancellation and audit trail.

**Acceptance:** a bounded multi-step task can run, stop, and report its actions and results.

## Phase 5 — Tools

- [ ] Tool registry.
- [ ] MCP client integration.
- [ ] Permission broker.
- [ ] File and browser integrations.
- [ ] GitHub integration.
- [ ] Prompt-injection-aware handling of untrusted tool content.

**Acceptance:** each tool has explicit capabilities, user-visible permissions, and tests.

## Phase 6 — Voice

- [ ] Speech-to-text adapter.
- [ ] Text-to-speech adapter.
- [ ] Device and provider settings.
- [ ] Push-to-talk interaction.
- [ ] Clear recording and processing indicators.

**Acceptance:** voice features work with a configured provider and clear user controls.

## Phase 7 — Automation

- [ ] Workflow definitions.
- [ ] Scheduled/manual triggers where supported.
- [ ] Approval gates.
- [ ] Run history and cancellation.
- [ ] Failure recovery.

**Acceptance:** workflows are observable, bounded, cancellable, and require approval for sensitive actions.

## Phase 8 — Release

- [ ] Full test pass and security review.
- [ ] Windows packaging and installer.
- [ ] Upgrade and data migration checks.
- [ ] User documentation.
- [ ] Release notes and versioning.

**Acceptance:** reproducible release build with documented limitations and verified installation.
