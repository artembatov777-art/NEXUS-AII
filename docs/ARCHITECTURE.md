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

The CLI composes the shared planner, sequential executor and Tool Gateway with
a deterministic workspace planner and a separate native workspace process.
See [the CLI planner contract](AGENTS.md#cli-workspace-planner) for the
approval, audit and recovery boundaries.

#### Shared execution boundary for CLI and Desktop (NEXUS AU 2.0)

`src/core/agentExecutionPolicy.ts` defines a host-neutral, fail-closed dispatch contract. Both `PlanExecutor` (CLI) and `createAgentWorkflow` (Desktop) validate a planned tool sequence against the **current** registered tools, bounded JSON input, unique step IDs, ordered dependencies, and the step budget before dispatch. Validation returns a detached JSON snapshot so later mutations by the caller do not change the admitted plan.

Desktop additionally enforces its owner-specified tool allowlist when the plan **runs**, not only when the model plans; the `MultiAgentCoordinator` carries a live tool guard through approval pauses and reevaluates it before every resumed or subsequent delegation. The CLI rechecks the registered tool immediately before each execution. The dispatch policy also captures an ephemeral Tool Registry registration token for every planned tool; removing and re-registering a tool with **the same ID and version** changes that token, invalidating the in-progress plan. The initial tool allowance is snapshotted at workflow creation and intersected with the owner's live allowed-ID list at planning, dispatch and every delegation. Revocation narrows existing plans, while adding IDs later never widens the original admission grant. An unregistered, replaced or newly disallowed tool fails closed; a model description or previously approved plan is not a capability grant. Wildcard `mcp.*` applies only to currently registered `mcp.` tools.

CLI plan execution now returns typed, non-retryable errors when a planner or tool adapter crashes, when execution finishes after cancellation, or when a progress observer fails after a completed tool step. Uncertain external outcomes must be inspected in the Tool Gateway audit before a new run is created.

The shared `executeSequentialPlan()` function handles already-known deterministic or model-backed plans: the CLI's model-backed `PlanExecutor.run()` delegates to it, and `WorkspacePlanner.runInspection()` / `WorkspacePlanner.plan()` now call it directly. Offline workspace tasks no longer pretend a model planned them. The strict plan boundary requires plain JSON, so callers omit absent optional fields (such as `query`) rather than passing `undefined`. This preserves native Windows read/list and plan-preview functionality without weakening untrusted-model validation.

For run inspection, `/audit status <run-id>` reuses the same `findAmbiguous()` analysis as Desktop `ToolReconciliationService` and reads the whole bounded run journal. It can identify tool steps needing external outcome review, but does not reconcile, execute or authorize retries.

**Not yet a single durable engine:** Desktop remains backed by its checkpointed coordinator and native SQLite/preview adapters, while CLI retains a sequential runner and a separate history store. This common policy is a verified prerequisite for unifying run identities, checkpoint ownership, state migration and progress events; it is not evidence that those migrations or exactly-once external side effects are complete.

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
