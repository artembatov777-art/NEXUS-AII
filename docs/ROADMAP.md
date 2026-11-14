# NEXUS AU — Active Development Roadmap

NEXUS AU is a private, single-owner AI environment. The active delivery order is intentionally **interface first, intelligence second**: finish the complete desktop and mobile experience before expanding the runtime behind it.

The seven phases below are the authoritative project sequence. Earlier milestone notes in other documents are historical implementation records and do not change this order.

## Product direction

- **Product:** NEXUS AU, a personal AI workspace rather than a public SaaS.
- **Design:** restrained JARVIS-inspired interface, deep black/graphite surfaces, muted cyan and blue accents, a dynamic central reactor, and consistent desktop/mobile behavior.
- **Model strategy:** hybrid local and cloud through provider-neutral adapters. Ollama is the initial local runtime; OmniRoute is excluded from active development and may be evaluated only during final integration if the owner chooses.
- **Data ownership:** private workspace data, inspectable memory, explicit permissions, export/backup, and no silent training on personal data.
- **Development rule:** distinguish implemented code, automated test evidence, and real device/runtime verification. A UI preset or mock is never evidence of a working backend.

## Phase I — Complete interface

**Status: in progress — automated verification passed; final visual refinement and fresh owner-side iPhone acceptance remain.** This phase is about the complete user experience and stable UI contracts. Mock data is acceptable where a backend belongs to a later phase, but every visible control must behave honestly and clearly identify unavailable integrations.

- [x] Establish the restrained JARVIS visual language and shared responsive styling.
- [x] Build the desktop workspace shell, navigation, chat, history, and system overview.
- [x] Add workspace panels for Projects, Memory, Knowledge, Agents, Tools & MCP, File System, Training Lab, global search, and provider settings.
- [x] Add backup/restore controls to provider settings.
- [x] Add an isolated iPhone-oriented preview route using `?demo=1`; demo interactions remain local and never contact an AI provider.
- [x] Add responsive layouts for the main desktop application and the mobile preview.
- [x] Add visible keyboard focus, reduced-motion behavior, and explicit preview/runtime disclosures.
- [x] Add mobile navigation dismissal and dialog Escape/focus/scroll handling.
- [x] Complete a full interaction audit of visible controls and module states; native-only and preview-only actions are explicitly disabled or disclosed, and destructive memory/document actions require confirmation.
- [x] Add automated UI coverage for mobile navigation, preview-only chat/agent actions, empty input handling, keyboard shortcuts, and dialog keyboard contracts (Vitest + jsdom).
- [x] Verify the hosted preview and main responsive workspace on a real iPhone Safari session (owner-confirmed on the earlier interface baseline; repeat after this visual refresh).
- [ ] Recheck the latest hosted mobile preview and responsive workspace on a real iPhone Safari session after the final visual refresh.
- [x] Historical baseline `ae4276e` passed frontend Quality, Mobile Interface Preview, and the native Windows/macOS/Linux matrix.
- [x] Frontend Quality passed on `435b8914e31126f8261e0f10e2921bc5d8314100` (59 test files, 391 tests, TypeScript/Vite production build, and npm audit with 0 vulnerabilities).
- [x] Native Windows/macOS/Linux matrix passed on `435b8914e31126f8261e0f10e2921bc5d8314100`, including Rust checks, library tests, and native application builds. The workflow also completed the Rust dependency audit successfully.
- [x] Mobile Interface Preview build and Pages deployment passed for UI-identical frontend commit `64f8d5d0b2d045d5326aac76a462518ed56a7e73`.
- [ ] Recheck the latest hosted mobile preview and responsive workspace on a real iPhone Safari session after the final visual refresh.

**Exit criteria:** every planned module is reachable; primary controls have real UI behavior or an honest disabled/demo state; desktop and mobile layouts are usable; keyboard navigation and dialogs behave consistently; CI passes. Do not close this phase based on screenshots or a static mock alone.

## Phase II — AI Core

**Status: active.**

- [x] Implement the provider-neutral model runtime and model registry lifecycle; live provider verification remains pending until the owner supplies credentials.
- [ ] Evaluate an optional OmniRoute adapter during final integration only if the owner explicitly chooses to add it; no OmniRoute UI, profile setup, or connection is part of current development.
- [x] Add model discovery, selection, status, health checks, normalized errors, usage, streaming, and cancellation.
- [x] Prepare the Ollama OpenAI-compatible `/v1` adapter and separate credential slot; live verification requires a running owner-side Ollama service.
- [x] Make local versus remote processing explicit and avoid inferring locality from a loopback provider URL.
- [x] Keep provider secrets in separate allowlisted OS credential-vault profiles (`default` for generic cloud-provider endpoints and `ollama` for additional provider API-key endpoints); the no-key profile is loopback-only. Browser storage never receives provider secrets.
- [x] Add bounded transient-status retries, Retry-After handling, cancellation-aware backoff, and request cleanup behavior.
- [x] Confirm the native Windows/macOS/Linux CI matrix on implementation commit `435b8914e31126f8261e0f10e2921bc5d8314100`; all three native builds and Rust test jobs passed. The subsequent branch-head commit `36cdfdd1fa6d96053ef9459b79ecd15310eb71a1` only reorders the root package dependency list in `Cargo.lock`.

**Exit criteria:** direct cloud-provider models and local models work through the provider-neutral router; model identity, route, errors, usage, streaming, and cancellation are observable and tested. An optional gateway is evaluated only in the final phase if the owner explicitly chooses it.

## Phase III — Memory & Knowledge

**Status: groundwork active in parallel with Phase II runtime validation; Phase II remains formally active until its exit criteria pass.**

- [x] Implement inspectable memory management with user-controlled create, revise, search, and deletion; memory records are included in versioned workspace export/backup.
- [x] Implement document ingestion and project-scoped knowledge retrieval with source/page/section provenance.
- [x] Add reliable indexing, rebuild, and recovery behavior: startup reconciliation, bounded batches, corrupt-row cleanup, cancellation, and resumable repair.
- [x] Integrate relevant approved profile memory and selected project knowledge into chat context and bounded AI agent-planning reference context; retrieved content is marked untrusted and source labels are retained.
- [x] Test privacy boundaries, project-scoped retrieval quality, source citations, and native/browser persistence.

**Exit criteria:** NEXUS can retrieve the right approved context across sessions and projects, cite source material, and let the owner inspect and control stored information.

## Phase IV — Agents & Tools

- [x] Implement the bounded agent runtime and model-driven planning through AI Core; full phase acceptance still requires integration and native smoke tests.
- [x] Implement approval, pause/resume, cancellation, durable SQLite checkpoints, and audit-led duplicate-step replay protection.
- [x] Add owner-confirmed manual reconciliation for ambiguous external outcomes; reconciliation records a terminal audit state and never reruns the tool.
- [x] Implement the Tool Gateway, MCP server configuration, session-aware HTTP transport, tool discovery/import, and per-call approval with input preview; broader OAuth/authentication and adversarial integration tests remain open.
- [x] Add audit-led replay protection that blocks duplicate execution of a previously started or terminal run/step.
- [ ] Add automatic idempotent result replay with persisted, input-bound results; external side effects remain blocked from automatic replay.
- [x] Expose tool scopes, per-call approvals, execution traces, and agent failures; finish end-to-end release verification.
- [x] Add integration tests for safe tool execution and denied high-risk file writes through the model-planned workflow.

**Exit criteria:** an agent can plan, request scoped tools, wait for owner approval, resume, and complete with a verifiable audit trail.

## Phase V — NEXUS File System

- [x] Implement native Windows folder selection and scoped filesystem permissions (Tauri dialog + Rust permission roots; cross-platform CI passed).
- [x] Browse and recursively search by name only inside owner-approved folders, with bounded depth, visited-entry, and result limits.
- [x] Read UTF-8 text/code files through the native host and hand selected file content to a guarded AI analysis draft (75 KB source cap and a 90 KB serialized chat-message cap; owner confirms before content enters the chat draft).
- [x] Create and edit regular files inside one approved root; rename/move require explicit UI confirmation and are implemented for individual entries.
- [x] Record owner-initiated file reads, content searches, create/edit/rename/move actions, and folder permission changes in the native audit history without storing private paths.
- [x] Add bounded raster-image previews (PNG/JPEG/GIF/WebP/BMP, signature-checked, 4 MB cap, read-only) and batch file moves with explicit confirmation, no-overwrite behavior, per-file audit events, and rollback attempts on partial failure; component and Rust tests cover success, conflicts, rollback, invalid image signatures, and size limits.
- [x] Add safe batch file rename with prefix/suffix patterns, extension preservation, same-directory scope, no-overwrite preflight, per-file audit events, rollback attempts, and component/Rust regression tests.
- [x] Refuse final-component symlink/reparse-point traversal for regular-file reads, image previews, and content search; create-new writes cannot truncate an existing destination. Existing-file writes use a checked handle and no-follow open flags.
- [ ] Add broader conflict resolution and recovery for interrupted or multi-file operations.
- [x] Detect external edits before saving an opened file; preserve the unsaved draft and offer an explicit reload of the latest version.
- [x] Resolve approved parent directories without canonicalizing the final file component; final-component symlinks/reparse points are refused for regular-file reads, image previews, and content search. Existing-file edits also reject hard-linked inodes using Unix metadata or the Windows file-handle API.
- [x] Keep browser preview disconnected from the host filesystem; native file commands are unavailable in browser mode.

**Exit criteria:** NEXUS can work with explicitly approved folders on Windows, while access remains scoped, visible, reversible where possible, and protected against unintended writes.

## Phase VI — Security & Integration

- [ ] Integrate UI, AI Core, memory, agents, tools, and filesystem through stable application contracts.
- [ ] Complete permission enforcement and approval policy across all modules.
- [ ] Complete credential-vault, secret-redaction, and data-routing reviews.
- [x] Add versioned backup/restore coverage for projects, conversations, memories, knowledge, agent checkpoints, Training Lab datasets/experiments, and sanitized audit/trace history. Provider keys and approved folder permissions are excluded; v1 backups remain importable with an explicit warning.
- [ ] Review CSP, Tauri capabilities, dependency advisories, and platform boundaries.
- [ ] Complete error handling, cancellation, observability, and recovery paths.
- [ ] Run a focused threat-model review against the integrated product.

**Exit criteria:** all modules operate as one system with consistent permissions, secure secret handling, traceable actions, and tested recovery.

## Phase VII — Testing & Release 1.0

- [ ] Complete unit, integration, end-to-end, and security test coverage for release-critical flows.
- [ ] Pass frontend Quality and native Windows/macOS/Linux build and Rust test workflows.
- [ ] Run real desktop smoke tests, including Windows credential-vault and filesystem permissions.
- [ ] Verify upgrade, backup/restore, crash recovery, and cancellation behavior.
- [ ] Produce signed/reproducible release artifacts and installation instructions.
- [ ] Publish release notes and a known-limitations list.

**Exit criteria:** the release candidate installs, starts, and completes the core workflows reliably on supported platforms, with CI evidence and manual smoke-test records. No phase is marked complete merely because its code compiles.

## Post-release / future research

- Native/offline STT/TTS, audio-file ingestion, and hands-free operation beyond the current browser/WebView speech controls.
- Expanded image/audio understanding and multimodal workflows.
- Multi-agent orchestration beyond the initial bounded runtime.
- Training Lab expansion, fine-tuning, and model artifact lifecycle.
- Native mobile client beyond the responsive/mobile preview.
- Research into a NEXUS-owned foundation model. Training a foundation model from scratch is not part of Release 1.0.

## Current verified engineering notes

- Active implementation branch: `feat/nexus-core-architecture`.
- Protected working rule: do not modify `main` and do not merge a pull request without the owner's permission.
- The mobile preview is isolated behind `?demo=1`, uses local sample data, and does not connect to AI providers or credentials.
- The isolated mobile preview has interaction coverage for navigation, secondary modules, demo chat, project and knowledge search, agent disclosure, tool details, notices, and voice disclosure. Current frontend Quality passed on `435b8914e31126f8261e0f10e2921bc5d8314100` with 59 test files and 391 tests; the native Windows/macOS/Linux matrix passed on the same implementation commit. The Mobile Interface Preview build and deployment passed for the UI-identical frontend commit `64f8d5d0b2d045d5326aac76a462518ed56a7e73`. A fresh owner-side iPhone Safari check after the latest visual refresh remains open.
- Browser preview uses the Web Clipboard API where permitted; provider secrets, model discovery, and native backup actions are disabled when the native desktop host is unavailable.
- The local transformer runtime is dynamically imported only when semantic embeddings are requested, keeping its large runtime out of the initial static import graph.
- An endpoint address does not prove that inference is local. OmniRoute is not configured during core development and may be evaluated as an optional adapter at final integration only if the owner chooses.
- Ollama requires a running local computer or server; it cannot run on the owner's iPhone by itself.
- Model catalog entries must originate from the provider's discovery response; configured model IDs must never be injected as if they were available. A later mobile-preview build exposed a missing `Database` icon import in `MobileDemo.tsx`; the import was restored. The hosted preview remains a static interface demo and is not connected to Rust, OmniRoute, Ollama, or the owner filesystem. Real Windows folder permissions and provider-key verification remain owner-side release gates.
