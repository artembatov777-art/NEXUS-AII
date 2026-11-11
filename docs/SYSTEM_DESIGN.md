# NEXUS AU — Personal AI System Design

**Status:** Strategic architecture for the personal AI ecosystem  
**Scope:** One primary owner; hybrid local-and-cloud desktop with owner-controlled remote compute.

## 1. Product boundary
NEXUS AU is a personal AI environment with a hybrid local-and-cloud model strategy. Local inference is supported directly; cloud models are routed through OmniRoute. NEXUS Model adaptation is a later goal. It is not a public multi-user SaaS product.

Two responsibilities must remain distinct:
- NEXUS Model supplies learned language and multimodal capabilities through model weights and inference.
- NEXUS AI Core assembles context, retrieves memory, coordinates agents, invokes tools, manages state, and exposes model capabilities through the desktop workspace.

## 2. Principles
1. Personal-first, not multi-tenant-first.
2. Modular monolith first.
3. Provider-neutral interfaces; local inference plus OmniRoute for cloud model routing.
4. Hybrid by design: local inference where practical; cloud inference through OmniRoute with visible remote-processing disclosure.
5. Ports and adapters for models, storage, tools, and inference engines.
6. Inspectable memory, provenance, backup, correction, and deletion.
7. Bounded and observable agent execution.
8. No silent training on private conversations or files.
9. Reproducible model/data experiments with versioning and rollback.
10. Honest capability claims backed by tests and real runs.

## 3. Topology

~~~text
Desktop UI -> Application Facade
  +--> Conversation & Workspace
  +--> Context Builder
  |      +--> Working context
  |      +--> Episodic memory
  |      +--> Semantic/profile memory
  |      +--> Project knowledge
  +--> NEXUS AI Core
  |      +--> Model Registry
  |      +--> Model Runtime
  |      +--> NEXUS Model (primary)
  |      +--> optional local/remote comparison models
  |      +--> Reasoning / Planner
  +--> Agent Runtime -> Tool Gateway -> Built-in tools / MCP
  +--> Voice & Multimodal
  +--> Automation
  +--> Evaluation / Training control plane
Storage: SQLite + managed files + OS credential vault
~~~

## 4. Model subsystem

### Model Registry
A model descriptor identifies stable ID, display name, version, source and license, architecture/tokenizer metadata, artifact format, quantization, context and modality capabilities, estimated hardware requirements, artifact location, and lifecycle state.

### Model Runtime
Owns discover, validate, import/download, load, unload, health-check, infer, stream, cancel, and resource reporting. Multiple inference backends are supported through adapters. Cloud providers are reached through OmniRoute's OpenAI-compatible `/v1` API; local inference uses a separate adapter and does not require the gateway. Cloud providers are reached through OmniRoute's OpenAI-compatible `/v1` API; local inference uses a separate adapter and does not require the gateway.

The runtime must not assume all models support identical tool calling, structured output, context length, or modalities. Capabilities are declared and validated.

### NEXUS Model stages
- Bootstrap: evaluate legally usable open-weight checkpoints for quality, license, hardware, context, and inference support.
- Personalization: establish behavior, retrieval, tool schemas, and curated examples.
- Fine-tuning: run controlled experiments only when evaluation identifies a gap and suitable data/compute are available.
- Independent model research: investigate tokenizer, architecture, pretraining data, and from-scratch training as a long-term effort.

Prompting and retrieval are not training. Fine-tuning an existing checkpoint is not pretraining a new foundation model.

### Training and data governance
Every training dataset needs a manifest with source, license/permission status, transformations, filtering, deduplication, and split assignment. Every experiment records code revision, configuration, seed, hardware, parent checkpoint, logs, output artifact, and evaluation.

Private conversations, files, and memories are excluded from training by default. The owner must deliberately curate and approve any private data used in a dataset.

## 5. Context and memory
Distinguish working context, episodic memory, semantic memory, procedural memory, and project knowledge. Each record has provenance, scope, timestamps, and deletion semantics. Retrieval returns source IDs and scores so the UI can explain why an item influenced a response.

## 6. Reasoning and agents
The model may propose plans and tool calls. A planner validates schemas, dependencies, allowed tools, budgets, and context. The coordinator manages specialist agents and task state. Each run records plan, steps, model version, tool invocations, outputs, and errors.

Agent limits are configurable by the owner but remain explicit. Cancellation, checkpointing, and recovery are core capabilities. Agents do not receive ambient host privileges.

## 7. Tool Gateway
All tools pass through one gateway: validate identity and input, resolve owner-configured capability policy, request approval when required, execute with timeout/cancellation, validate output, record a redacted audit event, and return the result as untrusted observation data.

MCP metadata and tool outputs are untrusted. A tool cannot grant itself permissions through its description.

## 8. Personal deployment and privacy
The default deployment has one primary owner and local profile. Tenant IDs, public registration, billing, and public quotas are not baseline requirements.

Remote inference may be used when local hardware is insufficient. The UI identifies when data leaves the device and which endpoint receives it. Credentials remain in the OS vault or a deliberately configured secret manager.

Backups include versioned structured workspace data and optional selected artifacts. Secrets are excluded by default. Restore validates input and is transactional where possible.

## 9. Request lifecycle
1. Validate input and create a trace.
2. Persist the user message.
3. Assemble bounded context from conversation and selected memory/knowledge.
4. Resolve an explicitly selected local model or an OmniRoute-routed cloud model.
5. Stream normalized inference events.
6. Validate proposed tool calls.
7. Execute through Tool Gateway and append structured observations.
8. Continue or stop based on budgets, cancellation, and owner policy.
9. Persist response, model metadata, and trace summary.

## 10. Delivery order
1. Finish and verify current desktop foundation and outstanding manual smoke tests.
2. Define model registry, runtime, and inference contracts.
3. Deliver one real local-model chat vertical slice.
4. Add model lifecycle UI, resource diagnostics, and fallback adapters.
5. Connect context and memory to the primary local model.
6. Add model evaluation harness and curated datasets.
7. Run the first reproducible fine-tuning experiment only when justified.
8. Expand agent, voice, and multimodal capabilities.
9. Keep training-from-scratch foundation-model research deferred and outside the active roadmap.

Each milestone compiles, has tests, and updates implementation status. No training pipeline or platform verification is marked complete without reproducible evidence.
