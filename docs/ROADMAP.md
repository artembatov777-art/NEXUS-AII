# NEXUS AU — Active Development Roadmap

This roadmap contains **seven active phases**. The independent foundation model from-scratch idea is deferred to Future Research and is not part of active completion or progress calculations.

## Product direction

NEXUS AU is a private personal AI desktop environment for one primary owner. It combines local model execution with cloud models routed through OmniRoute. NEXUS AI Core coordinates model selection, context, memory, agents, tools, multimodal services, and model lifecycle. NEXUS Model is a later adaptation goal, not a reason to postpone a working system.

## Parallel track — Mobile interface preview

**Status:** first standalone mobile preview screen implemented; publication and device verification remain.

- [x] Add an isolated demo entry point using `?demo=1`; the desktop app entry point remains unchanged.
- [x] Add responsive iPhone-oriented preview screens for chat, projects, memory, and settings.
- [x] Keep all demo interactions local and clearly disclose that no AI model is connected.
- [ ] Run production build and automated checks for the new preview.
- [ ] Publish a preview URL and verify it in iPhone Safari.
- [ ] Refine layouts after real-device feedback.

**Acceptance:** the owner can open a hosted URL on iPhone, inspect key workspace screens, and try demo-only interactions without contacting an AI provider or exposing credentials.

## Phase I — Architecture and infrastructure

**Status:** implementation substantially complete; final validation remains.

- [x] React + TypeScript + Vite frontend.
- [x] Tauri 2 / Rust desktop host.
- [x] SQLite persistence and versioned migrations.
- [x] Core domain, application services, provider-neutral model contracts.
- [x] Cross-platform CI build and Rust test matrix.
- [ ] Finalize remaining infrastructure-level integration checks and document release baseline.

**Acceptance:** stable module boundaries, reproducible builds, passing automated tests, and documented platform support.

## Phase II — Workspace and interface

**Status:** core workspace implemented; desktop acceptance remains.

- [x] Chat and conversation history.
- [x] Projects and project-aware workspace.
- [x] Settings and provider credential management.
- [x] Global search, backup and restore UI.
- [x] Add visible keyboard focus indicators, reduced-motion support, and semantic provider-settings dialog labels.
- [ ] Complete full keyboard-navigation and screen-reader audit.
- [ ] Finish native file-picker, notification, and deep-link workflows where they belong in the product.

**Acceptance:** the workspace is usable end-to-end, keyboard accessible, and reliable on supported desktop platforms.

## Phase III — Memory, agents, and tools

**Status:** major foundations implemented; production agent integration remains.

- [x] Long-term memory and project knowledge retrieval.
- [x] PDF, DOCX, TXT, and Markdown ingestion with provenance.
- [x] Semantic retrieval with lexical fallback.
- [x] Agent runtime, coordinator, checkpoints, and resume.
- [x] Tool Gateway, permission checks, audit and trace persistence.
- [x] MCP HTTP transport and bounded tool discovery.
- [ ] Complete model-driven agent planning against the real selected runtime.
- [ ] Add operation-level idempotency and durable reconciliation for external side effects.
- [ ] Finish the visual MCP server/tool management and plan-review experience.

**Acceptance:** a model-driven agent can plan, request approved tools, pause, resume, and complete with an auditable trace.

## Phase IV — Desktop, security, and stability

**Status:** code implementation substantially complete; automated dependency scanning has been added to CI, while manual platform verification remains open.

- [x] Native SQLite workspace persistence and migration.
- [x] OS credential-vault implementation.
- [x] Transactional backup/restore and recovery tests.
- [x] Native audit/trace and agent checkpoint persistence.
- [x] Windows/macOS/Linux CI build and Rust test matrix.
- [x] Source-level security review and platform smoke-test protocol.
- [x] Add npm dependency advisory scanning (`npm audit --audit-level=high`) to the Quality workflow.
- [ ] Resolve applicable dependency advisories and complete dependency review.
- [ ] Complete full accessibility, CSP/capability, release packaging, and upgrade review.
- [ ] Run and record interactive Tauri + credential-vault smoke tests on real Windows, macOS, and Linux desktop sessions.

**Acceptance:** all automated checks pass, security/dependency findings are triaged, and real desktop behavior is verified on supported platforms. CI compilation alone does not satisfy manual acceptance.

## Phase V — NEXUS AI Core and OmniRoute

**Status:** OmniRoute model discovery, bounded SSE streaming, native cancellation, and provider-neutral Model Registry foundations are implemented; verified runtime lifecycle, capability metadata, local runtime, and unified routing remain.

- [x] Add provider-neutral in-memory Model Registry, catalog refresh, active-model selection, and discovery-state contracts.
- [ ] Implement actual model runtime lifecycle and verified health checks.
- [x] Implement the native OpenAI-compatible cloud adapter used for OmniRoute `/v1` requests, including one-shot and SSE chat.
- [x] Discover available models through `GET /v1/models` and expose the model catalog to the native ModelProvider.
- [x] Implement bounded SSE chat completion streaming and incremental chat rendering.
- [x] Add native cancellation for active streams, including cancellation during connection/stream reads and early consumer exit.
- [ ] Normalize provider errors and usage metadata.
- [x] Store the provider credential in the OS vault; never expose it to the webview or logs.
- [ ] Keep local inference as a separate adapter under the same Model Runtime.
- [x] Disclose local versus remote model routing in the chat header.
- [x] Persist the owner-declared local/remote inference disclosure with provider settings.
- [ ] Add a verified active-model/runtime status panel and backend capability metadata.
- [ ] Connect chat, context assembly, and model-backed planning through the AI Core facade.

**Acceptance:** NEXUS AU can use a selected OmniRoute cloud model and a configured local model through the same application contracts, with streaming, cancellation, model identity, and clear data-routing disclosure.

## Phase VI — Training Lab and model development

**Status:** dataset governance, deterministic phrase-based evaluation, SQLite persistence for dataset manifests and experiment metadata, and a Training Lab workspace are implemented; artifact tracking and real model evaluation remain.

- [x] Add deterministic evaluation-suite contracts and baseline phrase scoring.
- [x] Add versioned dataset manifests with license, privacy/consent gates, provenance, and disjoint train/validation/test splits.
- [x] Add validated experiment records with model, code revision, hardware, configuration, and metrics metadata.
- [x] Persist versioned dataset manifests and immutable experiment records in native SQLite (browser preview uses localStorage).
- [x] Add a Training Lab workspace for registering dataset manifests and recording experiment metadata.
- [x] Add a manual deterministic phrase-evaluation bench that exports measured metrics into experiment records.
- [ ] Add content-addressed model artifact tracking and rollback.
- [ ] Compare prompting, retrieval, and tool improvements before fine-tuning.
- [ ] Add reproducible adapter/LoRA fine-tuning only when hardware and measured need justify it.
- [ ] Keep private conversations, files, and memories excluded from training by default.

**Acceptance:** a reproducible experiment demonstrates measured improvement on held-out tasks, with provenance and rollback. Fine-tuning an existing checkpoint is not training a foundation model from scratch.

## Phase VII — Multimodal AI and voice

**Status:** browser/WebView voice lifecycle and multimodal privacy/capability contracts are implemented; model-backed image/audio workflows and native voice remain planned.

- [x] Optional browser/WebView speech recognition and speech synthesis controls.
- [x] Harden browser/WebView speech recognition and synthesis lifecycle, permission errors, cancellation, and unmount cleanup.
- [ ] Add native/offline speech adapters and a unified explicit voice provider interface.
- [ ] Add image understanding through models that declare vision capability.
- [ ] Add audio/document workflows with source provenance.
- [x] Add model modality-capability and local/remote processing policy contracts with explicit remote approval.
- [ ] Surface the selected processing location and approval state in the multimodal UI.
- [ ] Consider video only after resource and privacy controls are established.

**Acceptance:** modality support is capability-checked, observable, cancellable, and reports local versus remote processing.

## Future Research — independent foundation model

Training a foundation model from scratch is **deferred**. It is not an active phase, has no delivery date, and does not affect the project's completion percentage. Reconsider it only after NEXUS AU has a stable runtime, measured gaps that cannot be solved through existing models/adaptation, legal data provenance, sufficient compute, and a credible research plan.

## Permanent engineering rules

- Preserve working code and verify the current branch before changes.
- Every module has a contract and tests.
- No fake implementations or completion claims.
- Never commit credentials, private tokens, or personal datasets.
- Private data is excluded from training by default.
- Local and OmniRoute adapters remain replaceable behind provider-neutral contracts.
- High-impact tools remain observable, interruptible, permission-scoped, and recoverable.
- CI success is not a substitute for interactive desktop verification.
