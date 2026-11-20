# NEXUS AU — Active Development Roadmap

NEXUS AU is a private, single-owner AI environment. **NEXUS AU 2.0 is now the active direction:** a real local Windows coding agent with CLI and Tauri Desktop using one shared Agent Engine, with existing Desktop functions and user data preserved.

**Active execution order (owner's 12-phase plan):** audit → shared engine → CLI → filesystem → terminal → agent loop → Git → memory → MCP/models → desktop → security → cross-platform verification and release. See [the 12-stage task list](../tasks/todo.md), [transition plan](../tasks/plan.md), and the repository root `AGENTS.md`. Live providers and credentials remain deferred until separately authorized.

**The seven phases below are historical Desktop implementation and acceptance evidence, not the current project phase order.** Their checked items do not prove CLI/Desktop integration, live model availability or release readiness. Preserve these milestones without replacing or regressing working Desktop functions.

## Product direction

- **Product:** NEXUS AU, a personal AI workspace rather than a public SaaS.
- **Design:** restrained JARVIS-inspired interface, deep black/graphite surfaces, muted cyan and blue accents, a dynamic central reactor, and consistent desktop/mobile behavior.
- **Model strategy:** hybrid local and cloud through provider-neutral adapters. The native host now has OpenAI Chat Completions and a separate Anthropic Messages adapter, with multi-profile task-aware routing and pre-output failover; live provider verification remains an owner-side gate. Built-in endpoint presets and routing limits are documented in [PROVIDER_COMPATIBILITY.md](PROVIDER_COMPATIBILITY.md). Ollama is the initial local runtime; OmniRoute is excluded from active development and may be evaluated only during final integration if the owner chooses.
- **Data ownership:** private workspace data, inspectable memory, explicit permissions, export/backup, and no silent training on personal data.
- **Development rule:** distinguish implemented code, automated test evidence, and real device/runtime verification. A UI preset or mock is never evidence of a working backend.
- **NEXUS Studio feature contract:** see [NEXUS_STUDIO.md](NEXUS_STUDIO.md) for the ten workspace features, their real data sources, and explicit non-claims.

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

**Exit criteria:** every planned module is reachable; primary controls have real UI behavior or an honest disabled/demo state; desktop and mobile layouts are usable; keyboard navigation and dialogs behave consistently; CI passes. Do not close this phase based on screenshots or a static mock alone.

## Phase II — AI Core

**Status: active.**

### Required multimodal and voice capabilities

The existing `src/core/multimodal.ts` is a policy-validation layer, not a provider-neutral image-generation implementation. A provider-neutral image router, secured Gemini 3.1 Flash Image server endpoint, and chat-composer dialog are implemented. Generated image data is attached to assistant messages and round-tripped through browser/native conversation storage. Iterative editing accepts generated or owner-selected PNG/JPEG/WebP sources with bounded size and signature validation; live provider verification remains open. `VoiceControls` includes a conversational mode on supported browser/WebView speech APIs; this is not a native/offline voice runtime. These distinctions must remain visible in the UI and release notes.

- [x] Add a provider-neutral image-generation contract/router with explicit provider capability declarations and capability discovery; generation support is never inferred from a text model's ID.
- [x] Add a secured Gemini 3.1 Flash Image server-side adapter and chat-composer dialog with explicit remote consent, allowlisted aspect ratios/resolutions, bounded response size, image-signature validation, and download. Quality CI passed on the current implementation; live provider verification remains owner-side.
- [x] Persist generated images as validated message attachments in conversation history and round-trip them through browser/native conversation storage; automated storage/repository tests cover the attachment lifecycle.
- [x] Support iterative image editing from an existing generated or user-selected PNG/JPEG/WebP image with MIME/signature validation, a 3.2 MB source limit, explicit remote consent, and regression tests.
- [x] Implement a real Gemini 3.1 Flash Image adapter with bounded prompt/output handling, clear provider attribution, and explicit remote-processing consent; automated Quality passed, live provider verification remains pending.
- [x] Add a chat-composer image-generation control, preview the returned image, and support safe download without placing provider secrets in browser storage; conversation-history persistence is implemented and covered by the attachment lifecycle tests above.
- [x] Add automated tests for unsupported providers, malformed image responses, source-image MIME/signature/size validation, cancellation, remote-consent denial, and Gemini adapter capability mapping. Quality passed on `434452fd5ceda0a92771cf33f513639b8c1abac2` (86 test files, production build, and npm audit).
- [x] Add an explicit browser/WebView conversational voice mode: capture speech, submit through the normal AI Core path, speak the completed answer, allow interruption, and return to listening. Automated lifecycle coverage exists; real-host verification remains pending.
- [ ] Add a native/offline STT/TTS runtime and platform-specific permission/availability checks; browser/WebView APIs are not evidence of offline support.
- [x] Keep one-shot push-to-talk available as a lower-permission alternative and disclose that browser/WebView speech services may process audio remotely.
- [x] Add voice-mode regression tests for duplicate transcript submission, permission denial, stopping a conversation, and cleanup on unmount.
- [ ] Add interruption and unsupported-host integration coverage on actual browser/WebView targets; automated stop/restart race, interruption/resume and unavailable-synthesis coverage exists; actual host integration verification remains incomplete.
- [x] Explicitly document that browser/WebView speech services are host-dependent and do not claim offline/native voice.


- [x] Implement the provider-neutral model runtime and model registry lifecycle; live provider verification remains pending until the owner supplies credentials.
- [x] Add a separate native Anthropic Messages adapter for Claude, including model discovery, request mapping, API-key headers, streaming text/usage parsing, cancellation, and protocol tests. Live account verification remains an owner-side gate.
- [x] Register multiple saved provider profiles in one task-aware router; classify coding, analysis, research, creative, and general requests; keep automatic routing within the active profile's declared local/remote route.
- [x] Add bounded failover to the next eligible provider only for retryable errors before the first visible text delta. Never switch silently after partial output.
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
- [x] Implement document ingestion and project-scoped knowledge retrieval with source/page/section provenance, including bounded multi-file batches and TXT/Markdown/source-code/CSV/JSON/JSONL/YAML/XML/PDF/DOCX parsing.
- [x] Import supported text/code files recursively from explicitly approved workspace roots into project knowledge, with depth/file/byte limits, path containment checks, sensitive-directory exclusions, and clear provider-transfer consent.
- [x] Add reliable indexing, rebuild, and recovery behavior: startup reconciliation, bounded batches, corrupt-row cleanup, cancellation, and resumable repair.
- [x] Integrate relevant approved profile memory and selected project knowledge into chat context and bounded AI agent-planning reference context; retrieved content is marked untrusted and source labels are retained.
- [x] Bound long chat prompts to the memory retriever's 500-character query limit so oversized user messages do not fail profile/project memory retrieval; regression coverage verifies the bounded query.
- [x] Test privacy boundaries, project-scoped retrieval quality, source citations, and native/browser persistence.
- [x] Serialize legacy project migration across repository instances and wait for migration before native project mutations; append knowledge through incremental ID-based SQLite upserts to avoid stale-snapshot resurrection.

**Exit criteria:** NEXUS can retrieve the right approved context across sessions and projects, cite source material, and let the owner inspect and control stored information.

## Phase IV — Agents & Tools

- [x] Implement the bounded agent runtime and model-driven planning through AI Core; full phase acceptance still requires integration and native smoke tests.
- [x] Connect Studio workflow checklists to the agent runtime as explicit task handoffs; the owner starts the run in Agent Command Center and retains per-tool approval control.
- [x] Implement approval, pause/resume, cancellation, durable SQLite checkpoints, and audit-led duplicate-step replay protection.
- [x] Add owner-confirmed manual reconciliation for ambiguous external outcomes; reconciliation records a terminal audit state and never reruns the tool.
- [x] Implement the Tool Gateway, MCP server configuration, session-aware HTTP transport, tool discovery/import, and per-call approval with input preview; broader OAuth/authentication and adversarial integration tests remain open.
- [x] Add audit-led replay protection that blocks duplicate execution of a previously started or terminal run/step.
- [ ] Add automatic idempotent result replay with persisted, input-bound results; external side effects remain blocked from automatic replay.
- [x] Expose tool scopes, per-call approvals, execution traces, and agent failures; finish end-to-end release verification.
- [x] Add integration tests for safe tool execution and denied high-risk file writes through the model-planned workflow.
- [x] Add an execution-evidence boundary to ordinary chat requests so text-only model responses cannot claim that files, code, or external actions were executed without a real host tool result.

**Exit criteria:** an agent can plan, request scoped tools, wait for owner approval, resume, and complete with a verifiable audit trail.

## Phase V — NEXUS File System

- [x] Implement native Windows folder selection and scoped filesystem permissions (Tauri dialog + Rust permission roots; cross-platform CI passed).
- [x] Browse and recursively search by name only inside owner-approved folders, with bounded depth, visited-entry, and result limits.
- [x] Read UTF-8 text/code files through the native host and hand selected file content to a guarded AI analysis draft (75 KB source cap and a 90 KB serialized chat-message cap; owner confirms before content enters the chat draft).
- [x] Create and edit regular files inside one approved root; rename/move require explicit UI confirmation and are implemented for individual entries.
- [x] Record owner-initiated file reads, content searches, create/edit/rename/move actions, and folder permission changes in the native audit history without storing private paths.
- [x] Add bounded raster-image previews (PNG/JPEG/GIF/WebP/BMP, signature-checked, 4 MB cap, read-only) and batch file moves with explicit confirmation, no-overwrite behavior, per-file audit events, and rollback attempts on partial failure; component and Rust tests cover success, conflicts, rollback, invalid image signatures, and size limits.
- [x] Add safe batch file rename with prefix/suffix patterns, extension preservation, same-directory scope, no-overwrite preflight, per-file audit events, rollback attempts, and component/Rust regression tests.
- [x] Persist batch-rename and batch-move intent in SQLite before the first filesystem mutation and recover interrupted batches on startup with no-overwrite rollback; ambiguous path states fail closed and remain visible in the File System panel.
- [x] Refuse final-component symlink/reparse-point traversal for regular-file reads, image previews, and content search; create-new writes cannot truncate an existing destination. Existing-file writes use a checked handle and no-follow open flags.
- [x] Add a visible retry action for interrupted-operation recovery after an owner resolves a path conflict in the file manager.
- [x] Add in-app recovery review and explicit manual-reconciliation acknowledgment for journal records that remain ambiguous after retry. NEXUS never overwrites conflicting paths; the owner resolves the conflict in the OS file manager and confirms reconciliation in the File System panel.
- [ ] Complete parent-directory TOCTOU hardening with directory-handle-relative operations and adversarial race tests.
- [x] Detect external edits before saving an opened file; preserve the unsaved draft and offer an explicit reload of the latest version.
- [x] Resolve approved parent directories without canonicalizing the final file component; final-component symlinks/reparse points are refused for regular-file reads, image previews, and content search. Existing-file edits also reject hard-linked inodes using Unix metadata or the Windows file-handle API.
- [x] Revalidate persisted approved roots at startup and discard grants if the canonical path changed or the root became a symlink/reparse point; regression coverage rejects a root replaced by an outside symlink.
- [x] Keep the final source component unresolved during move, rename, and batch-rename validation so a substituted final symlink cannot redirect the operation to its target.
- [x] Connect approved workspace folders to project knowledge import while retaining native path checks, size caps, binary-file exclusion, and explicit consent.
- [x] Keep browser preview disconnected from the host filesystem; native file commands are unavailable in browser mode.

**Exit criteria:** NEXUS can work with explicitly approved folders on Windows, while access remains scoped, visible, reversible where possible, and protected against unintended writes.

## Phase VI — Security & Integration

- [x] Integrate UI, AI Core, memory, agents, tools, and filesystem through stable application contracts: `NexusApplication` handles production chat, `NexusRuntime` composes agent/tool/memory services, repository adapters separate browser preview from native SQLite, and filesystem access remains behind scoped Tauri commands.
- [x] Complete permission enforcement and approval policy across all modules: default-deny Tool Gateway, host-bound actor identity, per-scope approvals, MCP per-call confirmation, approved-root filesystem access, and fail-closed audit-history verification.
- [x] Complete credential-vault, secret-redaction, and data-routing reviews: OS credential-vault storage, provider-key redaction across streamed and non-streamed output, explicit local/remote route disclosure, and documented platform limitations. Owner-side credential-vault lifecycle smoke tests remain a Phase VII release gate.
- [x] Add versioned backup/restore coverage for projects, conversations, memories, knowledge, agent checkpoints, Training Lab datasets/experiments, and sanitized audit/trace history. Provider keys and approved folder permissions are excluded; v1 backups remain importable with an explicit warning.
- [x] Authenticate encrypted-backup envelope metadata with AES-GCM additional authenticated data in schema v2 while retaining schema v1 import compatibility.
- [x] Redact provider credentials from successful non-streaming output and streamed SSE deltas, including credentials split across delta boundaries.
- [x] Validate model-generated agent step field types and add planner-level plus end-to-end prompt-injection tests proving untrusted reference context cannot expand the workflow tool allowlist or replace the owner-supplied goal.
- [x] Review CSP, Tauri capabilities, dependency advisories, and platform boundaries; CSP/capability contracts are regression-tested, RustSec warnings are documented as tracked upstream dependency risks, and OS credential/platform limitations plus filesystem TOCTOU residuals are recorded in the security review.
- [x] Complete error handling, cancellation, observability, and recovery paths: partial chat output is persisted after stream failure/cancellation; tool timeouts and ambiguous side effects are non-retryable; ToolGateway fails closed without verifiable audit history or a valid cancellation signal; durable audit and filesystem recovery journals support startup recovery and explicit manual reconciliation. Ambiguous filesystem conflicts still require owner review, tracked in Phase V.
- [x] Run a focused threat-model review against the integrated product; `THREAT_MODEL.md` and `SECURITY_REVIEW.md` record mitigations and residual risks, including parent-directory TOCTOU, upstream GTK/glib and unmaintained Rust dependencies, and owner-side credential-vault verification.

**Exit criteria:** all modules operate as one system with consistent permissions, secure secret handling, traceable actions, and tested recovery.

## Phase VII — Testing & Release 1.0

Image generation and conversational voice are release requirements, not roadmap footnotes. Release acceptance must verify at least one supported image-generation provider end to end, image persistence/rendering in conversation history, explicit remote-processing consent, and a complete voice conversation including interruption and permission-denied behavior.

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
- NEXUS Studio now exposes ten connected workspace capabilities. The inbox, concept graph, and workflow checklist are local browser records with bounded schema validation; scheduled briefings, cross-device synchronization, arbitrary workflow execution, offline speech, and background system monitoring are explicitly not claimed. See `docs/NEXUS_STUDIO.md` for the exact feature contract.
- Frontend Quality passed on `8da90f3f624a555955c0880ce3556229c75837e1`: 80 test files, 572 tests, TypeScript/Vite production build, and npm audit with 0 vulnerabilities. Native Windows/macOS/Linux matrix passed on `9edda9550d175c0367ab83ef4cc44eab14706b55`; the latest filesystem/Studio hardening commits are awaiting their own native CI completion.
- An endpoint address does not prove that inference is local. OmniRoute is not configured during core development and may be evaluated as an optional adapter at final integration only if the owner chooses.
- Ollama requires a running local computer or server; it cannot run on the owner's iPhone by itself.
- Model catalog entries must originate from the provider's discovery response; configured model IDs must never be injected as if they were available. A later mobile-preview build exposed a missing `Database` icon import in `MobileDemo.tsx`; the import was restored. The hosted preview remains a static interface demo and is not connected to Rust, OmniRoute, Ollama, or the owner filesystem. Real Windows folder permissions and provider-key verification remain owner-side release gates.
