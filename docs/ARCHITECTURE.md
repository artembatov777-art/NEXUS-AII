# NEXUS AU — Personal AI System Architecture

## Objective
NEXUS AU is a private personal AI environment with a hybrid local-and-cloud model strategy. Its architecture supports NEXUS Model as the intended primary model without coupling the application to one inference engine, hardware target, or external provider.

The product is designed for one primary owner. Multi-tenant SaaS concerns are not part of the default architecture. Optional remote compute and external model adapters remain owner-controlled integrations.

## High-level topology

~~~text
React + TypeScript desktop UI
          |
Application Facade / Tauri command boundary
          |
          +--> Conversation & Workspace
          +--> Context Builder
          +--> Memory / Knowledge Engine
          +--> NEXUS AI Core
          |      +--> Model Registry
          |      +--> Model Runtime
          |      +--> Inference Adapters
          |      |      +--> NEXUS Model (primary)
          |      |      +--> Local open-weight runtime
          |      |      +--> Optional remote providers
          |      +--> Reasoning / Planner
          |      +--> Evaluation interface
          +--> Agent Runtime / Coordinator
          +--> Tool Gateway / MCP
          +--> Voice & Multimodal Services
          +--> Automation Scheduler
          +--> Trace, Audit & Diagnostics
          |
Rust host + SQLite + managed local files
          +--> OS credential vault
          +--> owner-approved integrations
          +--> optional remote compute
~~~

## Technology baseline
- UI: React, TypeScript, Vite.
- Desktop host: Tauri 2 and Rust.
- Persistence: SQLite with versioned migrations and repository ports.
- Search: lexical and semantic retrieval with source provenance.
- Model integration: provider-neutral contracts and inference adapters.
- Tools: central Tool Gateway, MCP adapters, and narrowly scoped native commands.
- Quality: unit/integration tests, cross-platform CI, and manual desktop smoke tests.

## Architectural layers

### Presentation
Owns chat, workspace, settings, memory inspection, agent control, model management, diagnostics, and training/evaluation views. It must not hold secrets or execute privileged OS operations directly.

### Application facade
Coordinates use cases and exposes typed commands/events. It owns request lifecycle, trace IDs, cancellation propagation, and orchestration.

### NEXUS AI Core
Coordinates model selection and inference, context assembly, memory retrieval, tool-call handling, planning, response streaming, cancellation, and evaluation hooks. It is the application runtime, not itself a foundation model.

### Model Registry and Runtime
The registry stores model identity, version, format, capabilities, context limits, quantization, license metadata, hardware requirements, and artifact location. The runtime loads, unloads, health-checks, and invokes models through a stable interface.

Local inference engines and cloud services are connected through provider adapters that implement the same model contract. The initial runtime supports compatible `/v1` endpoints directly; the Model Runtime owns endpoint configuration, model discovery, health checks, streaming, cancellation, and error normalization. No gateway is required during core development, and no OmniRoute-specific profile builder or adapter is currently implemented. An optional gateway may be evaluated only during final integration if the owner explicitly chooses it; direct local and cloud adapters must remain independent. Credentials are stored in the OS vault; remote processing is disclosed to the owner.

### NEXUS Model lifecycle
NEXUS Model is the intended primary model. Its lifecycle includes base checkpoint selection and license review, tokenizer/config/weight metadata, dataset manifests, training experiments, evaluation suites, versioned artifacts, and rollback.

Initially, an open-weight model may serve as the base checkpoint. NEXUS-specific adaptation can begin with retrieval, prompting, tool-use data, and parameter-efficient fine-tuning. Training a new foundation model from scratch is a later research milestone.

### Context and memory
Context is assembled from recent conversation, explicitly selected project data, and owner-approved memory/knowledge. Retrieved items retain source metadata. Memory writes and retention policies are configurable and inspectable.

### Agents and tools
Agents are task runners with explicit identity, budgets, allowed tools, cancellation, and checkpoints. All tool calls pass through the Tool Gateway. MCP descriptions and results are untrusted data, not system instructions.

### Storage and privacy
SQLite is authoritative for structured desktop state. Large files and model artifacts use managed paths and opaque identifiers. Secrets belong in the OS credential vault. Backups exclude secrets by default.

Personal data must not be silently uploaded to training pipelines. Dataset inclusion requires deliberate curation and provenance.

## Dependency direction

~~~text
UI -> Application -> Domain contracts
Infrastructure -> Domain contracts
Tauri host -> Application + Infrastructure
Model adapters -> Model runtime ports
Training/evaluation -> versioned dataset/model artifacts
~~~

Domain modules must not import React, Tauri APIs, HTTP clients, SQLite drivers, or model SDKs.

## Request lifecycle
1. UI submits a typed message or task.
2. Application facade validates it and creates a trace.
3. Conversation service persists the user input.
4. Context builder assembles recent messages and permitted memory/knowledge.
5. NEXUS AI Core resolves the selected model and runtime.
6. Adapter performs inference and emits normalized stream events.
7. Proposed tool calls are validated and routed through the Tool Gateway.
8. Tool results return as structured, untrusted observations.
9. Model continues within configured budgets or stops for owner approval.
10. Response, usage metadata, and trace are persisted.

Cancellation must propagate through every layer where supported.

## Reliability
- Validate inputs at module boundaries.
- Bound context, output, file, and tool payload sizes.
- Use typed errors, timeouts, cancellation, and retry-safe operations.
- Redact credentials and sensitive diagnostics.
- Version database schemas, model artifacts, datasets, and evaluation results.
- Test core logic without a live model; separately test real local inference.
- A successful build is not proof of an interactive desktop experience.
