# NEXUS AU — Active Development Roadmap

NEXUS AU is a private, single-owner AI environment. The active delivery order is intentionally **interface first, intelligence second**: finish the complete desktop and mobile experience before expanding the runtime behind it.

The seven phases below are the authoritative project sequence. Earlier milestone notes in other documents are historical implementation records and do not change this order.

## Product direction

- **Product:** NEXUS AU, a personal AI workspace rather than a public SaaS.
- **Design:** restrained JARVIS-inspired interface, deep black/graphite surfaces, muted violet and blue accents, a dynamic central reactor, and consistent desktop/mobile behavior.
- **Model strategy:** hybrid local and cloud. OmniRoute is the selected gateway for cloud models; Ollama is the planned local runtime.
- **Data ownership:** private workspace data, inspectable memory, explicit permissions, export/backup, and no silent training on personal data.
- **Development rule:** distinguish implemented code, automated test evidence, and real device/runtime verification. A UI preset or mock is never evidence of a working backend.

## Phase I — Complete interface

**Status: in progress — final visual refinement and CI verification.** This phase is about the complete user experience and stable UI contracts. Mock data is acceptable where a backend belongs to a later phase, but every visible control must behave honestly and clearly identify unavailable integrations.

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
- [ ] Pass fresh frontend Quality, Mobile Interface Preview, and Native desktop quality workflows on the final Phase I commit. Historical baseline `38d23706260adf037885158bae3dbfb03284210c` passed all three workflows; the current visual refresh still requires a fresh green run.

**Exit criteria:** every planned module is reachable; primary controls have real UI behavior or an honest disabled/demo state; desktop and mobile layouts are usable; keyboard navigation and dialogs behave consistently; CI passes. Do not close this phase based on screenshots or a static mock alone.

## Phase II — AI Core

**Status: active.**

- [ ] Complete the provider-neutral model runtime and model registry lifecycle.
- [ ] Connect OmniRoute through its OpenAI-compatible API.
- [ ] Add model discovery, selection, status, health checks, normalized errors, usage, streaming, and cancellation.
- [ ] Prepare the Ollama adapter as a separate local inference path.
- [ ] Make local versus remote processing explicit and avoid inferring locality from a loopback gateway URL.
- [x] Keep provider secrets in separate allowlisted OS credential-vault profiles (`default` for existing OmniRoute installations and `ollama` for Ollama API-key endpoints); the no-key profile is loopback-only. Browser storage never receives provider secrets.
- [ ] Add reliable timeout, retry, and request cleanup behavior.

**Exit criteria:** a selected cloud model works through OmniRoute; the local adapter works when a local runtime is available; model identity, route, errors, usage, streaming, and cancellation are observable and tested.

## Phase III — Memory & Knowledge

**Status: groundwork active in parallel with Phase II runtime validation; Phase II remains formally active until its exit criteria pass.**

- [ ] Complete inspectable long-term memory with user-controlled create, revise, search, export, and deletion.
- [ ] Complete document ingestion and project-scoped knowledge retrieval with provenance.
- [ ] Add reliable indexing, rebuild, and recovery behavior.
- [ ] Integrate relevant approved memory and project knowledge into AI Core context assembly.
- [ ] Test privacy boundaries, retrieval quality, citations, and persistence.

**Exit criteria:** NEXUS can retrieve the right approved context across sessions and projects, cite source material, and let the owner inspect and control stored information.

## Phase IV — Agents & Tools

- [ ] Complete the agent runtime and model-driven planning through AI Core.
- [ ] Finish approval, pause/resume, cancellation, and durable checkpoints.
- [ ] Complete the Tool Gateway and MCP server/tool management UI.
- [ ] Add operation-level idempotency and recovery for external side effects.
- [ ] Make tool scopes, approvals, execution traces, and failures visible.
- [ ] Add integration tests for safe and denied tool execution.

**Exit criteria:** an agent can plan, request scoped tools, wait for owner approval, resume, and complete with a verifiable audit trail.

## Phase V — NEXUS File System

- [x] Implement native Windows folder selection and scoped filesystem permissions (Tauri dialog + Rust permission roots; cross-platform CI passed).
- [x] Browse and recursively search by name only inside owner-approved folders, with bounded depth, visited-entry, and result limits.
- [x] Read UTF-8 text/code files through the native host and hand selected file content to a guarded AI analysis draft (75 KB source cap and a 90 KB serialized chat-message cap; owner confirms before content enters the chat draft).
- [x] Create and edit regular files inside one approved root; rename/move require explicit UI confirmation and are implemented for individual entries.
- [ ] Add bulk organization, conflict recovery, and audit history.
- [ ] Add previews, conflict handling, recovery, and audit history.
- [ ] Keep browser preview disconnected from the host filesystem.

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

- Voice STT/TTS and hands-free operation.
- Expanded image/audio understanding and multimodal workflows.
- Multi-agent orchestration beyond the initial bounded runtime.
- Training Lab expansion, fine-tuning, and model artifact lifecycle.
- Native mobile client beyond the responsive/mobile preview.
- Research into a NEXUS-owned foundation model. Training a foundation model from scratch is not part of Release 1.0.

## Current verified engineering notes

- Active implementation branch: `feat/nexus-core-architecture`.
- Protected working rule: do not modify `main` and do not merge a pull request without the owner's permission.
- The mobile preview is isolated behind `?demo=1`, uses local sample data, and does not connect to AI providers or credentials.
- The mobile preview has five jsdom interaction tests. The earlier Phase I baseline passed Quality, mobile preview build/deploy, and native desktop CI; the current visual refresh is undergoing a new verification pass.
- Browser preview uses the Web Clipboard API where permitted; provider secrets, model discovery, and native backup actions are disabled when the native desktop host is unavailable.
- The local transformer runtime is dynamically imported only when semantic embeddings are requested, keeping its large runtime out of the initial static import graph.
- OmniRoute is a cloud gateway. A local gateway address does not prove that the selected model runs locally.
- Ollama requires a running local computer or server; it cannot run on the owner's iPhone by itself.
- A frontend test previously failed because the model-catalog expectation omitted the configured model; the test now covers both the configured model and the discovered catalog. A later mobile-preview build exposed a missing `Database` icon import in `MobileDemo.tsx`; the import was restored. Final Phase I CI passed: frontend Quality, mobile preview build/deploy, and native desktop quality on Windows, macOS, and Linux. The owner confirmed the hosted interface works on iPhone Safari.
