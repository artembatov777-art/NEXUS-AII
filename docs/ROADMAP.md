# NEXUS AU — Personal AI Development Roadmap

This roadmap defines the private, single-owner personal AI ecosystem. It supersedes the earlier public/hosted-client-first direction. A phase is complete only when its acceptance criteria are implemented and verified.

## Existing work — preserve and finish
The repository already contains substantial implementation in React/TypeScript, Tauri/Rust, SQLite persistence, memory/knowledge retrieval, agent runtime, MCP HTTP transport, Tool Gateway, credential vault, backup/restore, and CI.

Do not rebuild working modules merely to match a new diagram. First finish outstanding Phase IV/VI work in IMPLEMENTATION_PLAN.md, especially real desktop smoke tests and remaining native integrations.

## Phase 0 — Existing foundation and verification
**Status:** substantial implementation exists; manual acceptance remains open.
- [x] React + TypeScript + Vite application.
- [x] Tauri 2 / Rust desktop host.
- [x] Conversation, project, memory, and knowledge foundations.
- [x] Native SQLite persistence and migrations.
- [x] Agent runtime, coordinator, Tool Gateway, MCP HTTP adapter.
- [x] OS credential-vault implementation and backup/restore foundations.
- [x] Windows/macOS/Linux CI build and Rust test matrix for the recorded baseline.
- [ ] Complete real interactive desktop and credential-vault smoke tests.
- [ ] Finish remaining native integrations, accessibility, dependency/security audit, and release packaging.

**Acceptance:** existing capabilities and limitations are accurately documented and desktop behavior is verified on real systems.

## Phase 1 — NEXUS AI Core contracts
- [ ] Define model descriptor, capability, inference request/event, runtime status, and lifecycle contracts.
- [ ] Add Model Registry with version, source/license, artifact, quantization, modality, context, and hardware metadata.
- [ ] Define discover/import, validate, load, unload, health-check, infer, stream, and cancel operations.
- [ ] Keep provider-specific formats inside adapters.
- [ ] Connect existing conversation pipeline through the AI Core facade without breaking storage and memory.

**Acceptance:** fake and real adapters pass the same contract tests; application code does not depend on one backend.

## Phase 2 — First local model
- [ ] Evaluate open-weight checkpoints for license, quality, language coverage, context, tool use, hardware fit, and inference support.
- [ ] Select a compatible local inference backend.
- [ ] Implement local inference adapter and health/resource reporting.
- [ ] Deliver real local chat with streaming, cancellation, errors, and persisted history.
- [ ] Keep optional external adapters for comparison/fallback; OmniRoute is not required.

**Acceptance:** NEXUS AU loads and queries a documented local model through NEXUS AI Core and displays the active model identity.

## Phase 3 — Personal context and memory
- [ ] Build bounded context assembly for conversation, selected project knowledge, and approved memories.
- [ ] Preserve citations and provenance.
- [ ] Add owner-configurable retrieval and context budgets.
- [ ] Show which context sources were included.
- [ ] Test isolation between projects and conversations.

**Acceptance:** local primary model uses selected memory/knowledge without losing provenance or crossing project boundaries.

## Phase 4 — Personal agents and tools
- [ ] Connect model tool-call proposals to validated agent plans.
- [ ] Improve plan review, status, cancellation, resume, and failure recovery.
- [ ] Add owner-configured specialist agents and model assignment.
- [ ] Expand MCP and native integrations through Tool Gateway.
- [ ] Add operation idempotency and durable execution reconciliation.

**Acceptance:** a model-driven task can plan, request tools, pause/resume, and complete with a traceable record.

## Phase 5 — NEXUS Model adaptation
- [ ] Establish evaluation suites before training experiments.
- [ ] Create versioned dataset manifests with provenance and license/permission metadata.
- [ ] Curate task-specific examples from permitted sources.
- [ ] Compare prompting, retrieval, and tool improvements before fine-tuning.
- [ ] Run a reproducible parameter-efficient fine-tuning experiment if justified by hardware and evaluation.
- [ ] Version weights/adapters and retain rollback.

**Acceptance:** a documented experiment demonstrates measured improvement on held-out tasks. No private data enters training without deliberate curation and approval.

## Phase 6 — Multimodal and voice
- [ ] Define modality capabilities in the model registry.
- [ ] Improve voice input/output and interruption.
- [ ] Add image understanding through compatible local or owner-configured models.
- [ ] Add document and audio workflows with source tracking.
- [ ] Consider video only after runtime and resource budgets are established.

**Acceptance:** each modality uses explicit adapters and reports whether processing is local or remote.

## Phase 7 — Training and research lab
- [ ] Add experiment tracking, dataset validation, checkpoint management, and evaluation reports.
- [ ] Support repeatable training jobs outside the UI process.
- [ ] Add hardware/resource estimation and safe cancellation.
- [ ] Research tokenizer/architecture choices for a future independent foundation model.
- [ ] Evaluate cost and feasibility of from-scratch pretraining before committing resources.

**Acceptance:** experiments are reproducible, isolated from chat runtime, and have versioned artifacts and evaluation evidence.

## Phase 8 — Personal automation and system maturity
- [ ] Add owner-defined triggers and schedules.
- [ ] Add approvals, audit history, interruption, and recovery.
- [ ] Add diagnostics, performance profiles, and model switching.
- [ ] Complete platform packaging and upgrade tests.
- [ ] Maintain backup/restore and recovery procedures.

**Acceptance:** NEXUS AU is a dependable personal environment with transparent automation and recoverable state.

## Long-term objective — Independent NEXUS Foundation Model
A model pretrained from scratch is a research objective, not an assumed near-term deliverable. It requires data rights, tokenizer and architecture work, substantial compute, distributed training expertise, evaluation, and maintenance.

Proceed only when evidence shows that an independent foundation model is feasible and materially better for the owner's goals than adapting an existing checkpoint.

## Permanent engineering rules
- Preserve working code and verify the current branch before changes.
- Every module has a contract and tests.
- No fake implementations or completion claims.
- Never commit credentials, private tokens, or personal datasets.
- Private data is excluded from training by default.
- Model adapters remain replaceable; NEXUS Model remains the strategic primary.
- High-impact tools remain observable, interruptible, and recoverable.
- CI success is not a substitute for interactive desktop verification.
