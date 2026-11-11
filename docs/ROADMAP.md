# NEXUS AU — Active Development Roadmap

This roadmap contains **seven active phases**. The independent foundation model from-scratch idea is deferred to Future Research and is not part of active completion or progress calculations.

## Product direction

NEXUS AU is a private personal AI desktop environment for one primary owner. It combines local model execution with cloud models routed through OmniRoute. NEXUS AI Core coordinates model selection, context, memory, agents, tools, multimodal services, and model lifecycle. NEXUS Model is a later adaptation goal, not a reason to postpone a working system.

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
- [ ] Complete accessibility and keyboard-navigation audit.
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

**Status:** code implementation substantially complete; manual platform verification open.

- [x] Native SQLite workspace persistence and migration.
- [x] OS credential-vault implementation.
- [x] Transactional backup/restore and recovery tests.
- [x] Native audit/trace and agent checkpoint persistence.
- [x] Windows/macOS/Linux CI build and Rust test matrix.
- [x] Source-level security review and platform smoke-test protocol.
- [ ] Resolve applicable dependency advisories and complete dependency review.
- [ ] Finish accessibility, CSP/capability, release packaging, and upgrade review.
- [ ] Run and record interactive Tauri + credential-vault smoke tests on real Windows, macOS, and Linux desktop sessions.

**Acceptance:** all automated checks pass, security/dependency findings are triaged, and real desktop behavior is verified on supported platforms. CI compilation alone does not satisfy manual acceptance.

## Phase V — NEXUS AI Core and OmniRoute

**Status:** provider-neutral foundations exist; full gateway integration is next.

- [ ] Define and implement the Model Registry and runtime lifecycle contracts.
- [ ] Implement the OmniRoute cloud adapter using the OpenAI-compatible `/v1` API.
- [ ] Discover available models through `GET /v1/models`; retain model IDs and capability metadata.
- [ ] Implement chat completion streaming through SSE, including bounded parsing, cancellation, and normalized errors.
- [ ] Store the NEXUS-to-OmniRoute credential in the OS vault; never expose it to the webview or logs.
- [ ] Keep local inference as a separate adapter under the same Model Runtime.
- [ ] Add explicit local/cloud routing and show the active model, adapter, and remote-processing status.
- [ ] Connect chat, context assembly, and model-backed planning through the AI Core facade.

**Acceptance:** NEXUS AU can use a selected OmniRoute cloud model and a configured local model through the same application contracts, with streaming, cancellation, model identity, and clear data-routing disclosure.

## Phase VI — Training Lab and model development

**Status:** planned.

- [ ] Add model evaluation suites and baseline task sets.
- [ ] Add versioned dataset manifests with source, license, permission, filtering, and split metadata.
- [ ] Add experiment tracking for configuration, code revision, hardware, checkpoints, and evaluation.
- [ ] Compare prompting, retrieval, and tool improvements before fine-tuning.
- [ ] Add reproducible adapter/LoRA fine-tuning only when hardware and measured need justify it.
- [ ] Version model artifacts and support rollback.
- [ ] Keep private conversations, files, and memories excluded from training by default.

**Acceptance:** a reproducible experiment demonstrates measured improvement on held-out tasks, with provenance and rollback. Fine-tuning an existing checkpoint is not training a foundation model from scratch.

## Phase VII — Multimodal AI and voice

**Status:** basic browser/WebView voice controls exist; broader multimodal work is planned.

- [x] Optional browser/WebView speech recognition and speech synthesis controls.
- [ ] Add stable voice input/output lifecycle through explicit adapters.
- [ ] Add interruption and cancellation for active voice sessions.
- [ ] Add image understanding through models that declare vision capability.
- [ ] Add audio/document workflows with source provenance.
- [ ] Show whether each modality is processed locally or remotely.
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
